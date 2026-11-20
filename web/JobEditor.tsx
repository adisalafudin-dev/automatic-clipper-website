import { useEffect, useMemo, useRef, useState } from "react";
import type { JobView, UiClipEdit, UiSentence } from "../src/types.ts";
import { MODES, type ModeName, type ModeProfile } from "../src/modes.ts";
import { createClip, getModes, getTranscript, removeClip, renderClip, renderStale, retryJob, saveClipEdit } from "./api.ts";
import { clampRange, durationWarning, formatTime, parseTime, sentenceSelectionRange, snapRangeToWords, type TimeRange } from "./lib/trim.ts";

type JobDetail = { job: JobView; edits: Record<string, UiClipEdit> };
type Props = { detail: JobDetail; onEditSaved: () => Promise<void> };

const clock = (ms: number) => formatTime(ms).slice(0, -4);
const isDefaultGamingFacecamRect = (rect: typeof MODES.gaming.facecamRect | null) =>
  !rect || (Math.abs(rect.x - 0.7) < 0.0001 && Math.abs(rect.y - 0.7) < 0.0001 && Math.abs(rect.w - 0.3) < 0.0001 && Math.abs(rect.h - 0.3) < 0.0001);

export function JobEditor({ detail, onEditSaved }: Props) {
  const { job } = detail;
  const clips = job.result?.clips ?? [];
  const [selectedId, setSelectedId] = useState(clips[0]?.id ?? "");
  const [sentences, setSentences] = useState<UiSentence[]>([]);
  const [loop, setLoop] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [range, setRange] = useState<TimeRange>({ startMs: clips[0]?.start ?? 0, endMs: clips[0]?.end ?? 0 });
  const [snap, setSnap] = useState(true);
  const [saveState, setSaveState] = useState("Saved");
  const [startText, setStartText] = useState(formatTime(clips[0]?.start ?? 0));
  const [endText, setEndText] = useState(formatTime(clips[0]?.end ?? 0));
  const [captionDraft, setCaptionDraft] = useState<Record<number, string>>({});
  const [selectedSentenceIds, setSelectedSentenceIds] = useState<number[]>([]);
  const [renderMode, setRenderMode] = useState<ModeName>(job.mode);
  const [renderFaceTracking, setRenderFaceTracking] = useState(job.faceTracking);
  const [renderCaptions, setRenderCaptions] = useState(job.captionsEnabled);
  const [autoDetectFacecam, setAutoDetectFacecam] = useState(isDefaultGamingFacecamRect(job.facecamRect));
  const [renderFacecamRect, setRenderFacecamRect] = useState(job.facecamRect ? `${job.facecamRect.x},${job.facecamRect.y},${job.facecamRect.w},${job.facecamRect.h}` : "0.70,0.70,0.30,0.30");
  const [modes, setModes] = useState<ModeProfile[]>([]);
  const selectionAnchor = useRef<number | null>(null);
  const dirty = useRef(false);
  const captionDirty = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const selected = clips.find((clip) => clip.id === selectedId) ?? clips[0];

  useEffect(() => { void getModes().then(setModes).catch((reason: unknown) => setLoadError(reason instanceof Error ? reason.message : String(reason))); }, []);
  useEffect(() => {
    setRenderMode(job.mode);
    setRenderFaceTracking(job.faceTracking);
    setRenderCaptions(job.captionsEnabled);
    setAutoDetectFacecam(isDefaultGamingFacecamRect(job.facecamRect));
    setRenderFacecamRect(job.facecamRect ? `${job.facecamRect.x},${job.facecamRect.y},${job.facecamRect.w},${job.facecamRect.h}` : "0.70,0.70,0.30,0.30");
  }, [job.id]);

  useEffect(() => {
    let active = true;
    let timer = 0;
    const loadTranscript = async () => {
      try {
        const items = await getTranscript(job.id);
        if (!active) return;
        setSentences(items);
        setLoadError("");
        if (items.length === 0 && (job.status === "queued" || job.status === "running")) {
          timer = window.setTimeout(() => void loadTranscript(), 1_500);
        }
      } catch (reason) {
        if (active) setLoadError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    void loadTranscript();
    return () => { active = false; window.clearTimeout(timer); };
  }, [job.id, job.status]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selected) return;
    video.pause();
    const savedEdit = detail.edits[selected.id];
    const savedRange = { startMs: savedEdit?.startMs ?? selected.start, endMs: savedEdit?.endMs ?? selected.end };
    setRange(savedRange);
    setStartText(formatTime(savedRange.startMs));
    setEndText(formatTime(savedRange.endMs));
    setCaptionDraft(Object.fromEntries((savedEdit?.captionWords ?? []).map((edit) => [edit.wordIndex, edit.text])));
    dirty.current = false;
    captionDirty.current = false;
    video.currentTime = savedRange.startMs / 1000;
    setPlayhead(savedRange.startMs);
  }, [job.id, selected?.id]);

  useEffect(() => {
    if (!selected || (!dirty.current && !captionDirty.current)) return;
    setSaveState("Saving…");
    const timer = window.setTimeout(() => {
      void saveClipEdit(job.id, selected.id, {
        startMs: range.startMs,
        endMs: range.endMs,
        caption: captionDirty.current ? "" : detail.edits[selected.id]?.caption ?? "",
        captionWords: Object.entries(captionDraft).map(([wordIndex, text]) => ({ wordIndex: Number(wordIndex), text })),
        style: detail.edits[selected.id]?.style,
        titleOverlay: detail.edits[selected.id]?.titleOverlay,
        layout: detail.edits[selected.id]?.layout,
      }).then(() => {
        dirty.current = false;
        captionDirty.current = false;
        setSaveState("Saved");
        onEditSaved();
      }).catch((reason: unknown) => {
        setSaveState(reason instanceof Error ? reason.message : String(reason));
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [captionDraft, detail.edits, job.id, onEditSaved, range, selected]);

  const sourceDuration = sentences.at(-1)?.end ?? selected?.end ?? 0;
  const allWords = useMemo(() => sentences.flatMap((sentence) => sentence.words), [sentences]);
  const updateRange = (next: TimeRange) => {
    const bounded = clampRange(next, sourceDuration);
    const finalRange = snap ? snapRangeToWords(bounded, allWords, sourceDuration) : bounded;
    setRange(finalRange);
    setStartText(formatTime(finalRange.startMs));
    setEndText(formatTime(finalRange.endMs));
    dirty.current = true;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (event.key === " ") {
        event.preventDefault();
        const video = videoRef.current;
        if (video?.paused) void video.play(); else video?.pause();
      } else if (event.key === "[") updateRange({ ...range, startMs: playhead });
      else if (event.key === "]") updateRange({ ...range, endMs: playhead });
      else if (event.key.toLowerCase() === "l") setLoop((value) => !value);
      else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const amount = (event.shiftKey ? 1000 : 100) * (event.key === "ArrowLeft" ? -1 : 1);
        const next = clampRange({ startMs: range.startMs + amount, endMs: range.endMs + amount }, sourceDuration);
        updateRange(next);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playhead, range, sourceDuration, snap, allWords]);

  const currentSentence = useMemo(() => sentences.find((sentence) => playhead >= sentence.start && playhead <= sentence.end), [sentences, playhead]);
  const videoUrl = `/jobs/${encodeURIComponent(job.id)}/source`;
  const warning = durationWarning(range);
  const renderStatus = selected ? detail.edits[selected.id]?.renderStatus ?? "done" : "none";
  const renderedVersion = selected ? detail.edits[selected.id]?.renderedAt ?? "initial" : "initial";
  const renderedUrl = selected ? `/jobs/${encodeURIComponent(job.id)}/clips/${encodeURIComponent(selected.id)}/file?v=${encodeURIComponent(renderedVersion)}` : "";
  const windowStart = Math.max(0, range.startMs - 30_000);
  const windowEnd = Math.min(sourceDuration, range.endMs + 30_000);
  const windowSpan = Math.max(1, windowEnd - windowStart);
  const commitTimeText = (edge: "startMs" | "endMs", value: string) => {
    const parsed = parseTime(value);
    if (parsed === null) {
      setSaveState("Use mm:ss.mmm");
      return;
    }
    updateRange({ ...range, [edge]: parsed });
  };
  const updateCaptionWord = (wordIndex: number, text: string) => {
    setCaptionDraft((current) => ({ ...current, [wordIndex]: text }));
    captionDirty.current = true;
  };
  const selectSentence = (sentenceId: number, extend: boolean) => {
    if (extend && selectionAnchor.current !== null) {
      const low = Math.min(selectionAnchor.current, sentenceId);
      const high = Math.max(selectionAnchor.current, sentenceId);
      setSelectedSentenceIds(sentences.filter((sentence) => sentence.id >= low && sentence.id <= high).map((sentence) => sentence.id));
    } else {
      setSelectedSentenceIds((current) => current.includes(sentenceId)
        ? current.filter((id) => id !== sentenceId)
        : [...current, sentenceId].sort((a, b) => a - b));
    }
    selectionAnchor.current = sentenceId;
  };
  const addSelectedClip = async () => {
    const selection = sentenceSelectionRange(sentences, selectedSentenceIds);
    if (!selection) return;
    try {
      await createClip(job.id, selection.startMs, selection.endMs);
      setSelectedSentenceIds([]);
      await onEditSaved();
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const deleteSelectedClip = async () => {
    if (!selected || !window.confirm(`Delete ${selected.title}?`)) return;
    try {
      await removeClip(job.id, selected.id);
      setSelectedId("");
      await onEditSaved();
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const rerenderWithSettings = async () => {
    try {
      await renderStale(job.id, { mode: renderMode, faceTracking: renderFaceTracking, captionsEnabled: renderCaptions, facecamRect: renderMode === "gaming" && !autoDetectFacecam ? renderFacecamRect : null });
      await onEditSaved();
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return <section className="editor-shell" aria-label="Job editor">
    <header className="editor-heading"><div><span className="eyebrow">JOB EDITOR</span><h2>{job.filename}</h2></div><div className="editor-actions">{clips.length > 0 && <button className="button" disabled={job.status === "running" || job.status === "queued"} onClick={() => void renderStale(job.id).then(onEditSaved).catch((reason: unknown) => setLoadError(reason instanceof Error ? reason.message : String(reason)))}>Render all stale</button>}{clips.length === 0 && job.status === "completed" && <button className="button" onClick={() => void retryJob(job.id).then(onEditSaved).catch((reason: unknown) => setLoadError(reason instanceof Error ? reason.message : String(reason)))}>Retry clip generation</button>}<span className={`badge ${job.status}`}>{job.status}</span></div></header>
    {loadError && <p className="error" role="alert">{loadError}</p>}
    {job.status !== "completed" && <div className="editor-progress"><span>{job.error ? `Failed: ${job.error}` : `${job.stage} · ${job.progress}%`}</span><div className="progress-track"><div className="progress-fill" style={{ width: `${job.progress}%` }} /></div></div>}
    {clips.length > 0 && <details className="job-render-settings"><summary><span><strong>Render settings</strong><small>Mode: {job.mode} · Face tracking: {job.faceTracking ? "On" : "Off"} · Subtitles: {job.captionsEnabled ? "On" : "Off"}</small></span><span className="router-settings-chevron" aria-hidden="true">⌄</span></summary><div className="job-render-settings-body"><p className="muted">Change these options and re-render every clip. Your selections are saved with this project.</p><label className="form-field"><span>Mode</span><select value={renderMode} disabled={job.status === "running" || job.status === "queued"} onChange={(event) => setRenderMode(event.currentTarget.value as ModeName)}>{modes.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select></label>{renderMode === "gaming" && <><label className="upload-option"><input type="checkbox" checked={autoDetectFacecam} disabled={job.status === "running" || job.status === "queued"} onChange={(event) => setAutoDetectFacecam(event.currentTarget.checked)} /><span><strong>Auto-detect facecam</strong><small>Find the camera region; uncheck for manual placement</small></span></label>{!autoDetectFacecam && <label className="form-field"><span>Facecam x,y,w,h</span><input value={renderFacecamRect} disabled={job.status === "running" || job.status === "queued"} onChange={(event) => setRenderFacecamRect(event.currentTarget.value)} aria-label="Facecam rectangle normalized x,y,w,h" /></label>}</>}<div className="job-render-toggles"><label className="upload-option"><input type="checkbox" checked={renderFaceTracking} disabled={job.status === "running" || job.status === "queued"} onChange={(event) => setRenderFaceTracking(event.currentTarget.checked)} /><span><strong>Track faces</strong><small>Keep the speaker in frame</small></span></label><label className="upload-option"><input type="checkbox" checked={renderCaptions} disabled={job.status === "running" || job.status === "queued"} onChange={(event) => setRenderCaptions(event.currentTarget.checked)} /><span><strong>Add subtitles</strong><small>Burn captions into clips</small></span></label></div><div className="job-render-actions"><span className="muted">All clips will be rendered again.</span><button className="button primary" disabled={job.status === "running" || job.status === "queued"} onClick={() => void rerenderWithSettings()}>Re-render all clips</button></div></div></details>}
    <div className="editor-grid">
      <aside className="editor-column clip-column"><h3>Clips <span>{clips.length}</span></h3>{clips.length ? clips.map((clip) => {
        const status = detail.edits[clip.id]?.renderStatus ?? "done";
        return <button className={`clip-choice ${selected?.id === clip.id ? "active" : ""}`} key={clip.id} onClick={() => setSelectedId(clip.id)}><strong>{clip.title}</strong><span className="clip-meta"><span>{clock(clip.duration)}</span><span>Score {clip.score}/10</span></span><span className={`badge ${status}`}>{status}</span></button>;
      }) : <p className={job.status === "failed" ? "error" : "muted"}>{job.status === "failed" ? `Clip generation failed: ${job.error ?? "unknown error"}` : job.status === "completed" ? "No clips were created. Retry clip generation to reuse the transcript and try selection again." : "Clips will appear here automatically when processing finishes."}</p>}</aside>
      <section className="editor-column preview-column" aria-label="Source preview">
        {selected ? <>
          <div className="preview-heading"><div><span className="eyebrow">SELECTED CLIP</span><h3>{selected.title}</h3></div><span className="preview-score">{clock(selected.duration)} · {selected.score}/10</span></div>
          <div className="preview-frame"><video ref={videoRef} src={videoUrl} controls preload="metadata" onTimeUpdate={(event) => {
            const time = event.currentTarget.currentTime * 1000;
            setPlayhead(time);
            if (time >= range.endMs) {
              event.currentTarget.pause();
              event.currentTarget.currentTime = loop ? range.startMs / 1000 : range.endMs / 1000;
              setPlayhead(loop ? range.startMs : range.endMs);
            }
          }} onPlay={(event) => {
            const time = event.currentTarget.currentTime * 1000;
            if (time < range.startMs || time >= range.endMs) event.currentTarget.currentTime = range.startMs / 1000;
          }} /></div>
          <div className="preview-tools"><label><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.currentTarget.checked)} /> Loop preview</label><span>{clock(range.startMs)}–{clock(range.endMs)}</span></div>
          <div className="caption-preview"><span>Caption preview</span><p className="preview-caption">{currentSentence?.words.map((word) => captionDraft[word.wordIndex ?? -1] ?? word.text).filter(Boolean).join(" ") ?? selected.hook}</p><small>Final appearance is shown in the rendered clip.</small></div>
          <div className="trim-fields"><label>Start<input value={startText} onChange={(event) => setStartText(event.currentTarget.value)} onBlur={() => commitTimeText("startMs", startText)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label><label>End<input value={endText} onChange={(event) => setEndText(event.currentTarget.value)} onBlur={() => commitTimeText("endMs", endText)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label></div>
          <div className="range-wrap"><input aria-label="Clip start range" type="range" min="0" max={windowSpan} step="100" value={Math.min(windowSpan, Math.max(0, range.startMs - windowStart))} onChange={(event) => updateRange({ ...range, startMs: windowStart + Number(event.currentTarget.value) })} /><input aria-label="Clip end range" type="range" min="0" max={windowSpan} step="100" value={Math.min(windowSpan, Math.max(0, range.endMs - windowStart))} onChange={(event) => updateRange({ ...range, endMs: windowStart + Number(event.currentTarget.value) })} /></div>
          <div className="trim-toolbox">
            <div className="trim-tool-group"><span>Set from playhead</span><div><button onClick={() => updateRange({ ...range, startMs: playhead })}>Set start</button><button onClick={() => updateRange({ ...range, endMs: playhead })}>Set end</button></div></div>
            <div className="trim-tool-group"><span>Fine adjust · 0.1 sec</span><div><button onClick={() => updateRange({ ...range, startMs: range.startMs - 100 })}>Start −</button><button onClick={() => updateRange({ ...range, startMs: range.startMs + 100 })}>Start +</button><button onClick={() => updateRange({ ...range, endMs: range.endMs - 100 })}>End −</button><button onClick={() => updateRange({ ...range, endMs: range.endMs + 100 })}>End +</button></div></div>
            <div className="trim-tool-group"><span>Playback</span><div><button onClick={() => { if (videoRef.current) videoRef.current.currentTime = range.startMs / 1000; }}>Jump to start</button><button onClick={() => { if (videoRef.current) videoRef.current.currentTime = range.endMs / 1000; }}>Jump to end</button><button onClick={() => updateRange({ startMs: detail.edits[selected.id]?.origStartMs ?? selected.start, endMs: detail.edits[selected.id]?.origEndMs ?? selected.end })}>Reset</button><label><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.currentTarget.checked)} /> Snap to words</label></div></div>
          </div>
          <p className="trim-status">Duration {formatTime(range.endMs - range.startMs)} · {saveState}{warning && <span className="warning"> · Outside 30–90 sec</span>}</p>
          <div className="render-controls"><button className="button primary" disabled={job.status === "running" || job.status === "queued" || renderStatus === "queued" || renderStatus === "rendering"} onClick={() => void renderClip(job.id, selected.id, { mode: renderMode, faceTracking: renderFaceTracking, captionsEnabled: renderCaptions, facecamRect: renderMode === "gaming" && !autoDetectFacecam ? renderFacecamRect : null }).then(onEditSaved).catch((reason: unknown) => setLoadError(reason instanceof Error ? reason.message : String(reason)))}>{renderStatus === "queued" || renderStatus === "rendering" ? "Rendering…" : renderStatus === "done" ? "Render again" : "Render clip"}</button><span className={`badge ${renderStatus}`}>{renderStatus}</span><button className="button danger" disabled={job.status === "running" || job.status === "queued"} onClick={() => void deleteSelectedClip()}>Delete clip</button></div>
          {detail.edits[selected.id]?.renderError && <p className="error" role="alert">{detail.edits[selected.id]!.renderError}</p>}
          {renderStatus === "done" && <div className="rendered-result"><h4>Rendered clip</h4><video key={renderedVersion} controls preload="metadata" src={renderedUrl} /><a href={renderedUrl} download={`${selected.id}.mp4`}>Download clip</a></div>}
        </> : <p className="muted">Select a clip to preview.</p>}
      </section>
      <aside className="editor-column transcript-column"><div className="transcript-heading"><div><h3>Transcript & captions</h3><p>Select a sentence to preview it. Shift-click to select a range.</p></div><span>{sentences.length}</span></div>{selectedSentenceIds.length > 0 && <p className="selection-hint">{selectedSentenceIds.length} sentence{selectedSentenceIds.length === 1 ? "" : "s"} selected</p>}<button className="button create-clip-button" disabled={!selectedSentenceIds.length} onClick={() => void addSelectedClip()}>Create clip from selection</button>{sentences.length ? <div className="transcript-list">{sentences.map((sentence) => <div className={`caption-line ${currentSentence?.id === sentence.id ? "current" : ""} ${selectedSentenceIds.includes(sentence.id) ? "selected-sentence" : ""}`} key={sentence.id}><button className="sentence-selector" onClick={(event) => selectSentence(sentence.id, event.shiftKey)} aria-pressed={selectedSentenceIds.includes(sentence.id)}><span>{clock(sentence.start)}</span>{sentence.text}</button><div className="caption-line-words">{sentence.words.map((word, wordIndex) => {
          const index = word.wordIndex ?? wordIndex;
          const editable = word.end > range.startMs && word.start < range.endMs;
          const text = captionDraft[index] ?? word.text;
          return <span className={`caption-word ${playhead >= word.start && playhead <= word.end ? "playing" : ""}`} key={index}><button type="button" onClick={() => { if (videoRef.current) videoRef.current.currentTime = word.start / 1000; }}>{text || "(removed)"}</button>{editable && <input aria-label={`Edit word ${word.text}`} value={text} onChange={(event) => updateCaptionWord(index, event.currentTarget.value)} />}</span>;
        })}</div></div>)}</div> : <p className="muted">Transcript will appear when transcription completes.</p>}<details className="shortcut-help"><summary>Keyboard shortcuts</summary><p>Space play/pause · [ / ] set trim · ← / → nudge 100 ms · Shift + ← / → nudge 1 sec · L loop</p></details></aside>
    </div>
  </section>;
}
