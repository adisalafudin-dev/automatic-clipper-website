import { useEffect, useMemo, useRef, useState } from "react";
import type { JobView, UiClipEdit, UiSentence } from "../src/types.ts";
import { getTranscript, saveClipEdit } from "./api.ts";
import { clampRange, durationWarning, formatTime, parseTime, snapRangeToWords, type TimeRange } from "./lib/trim.ts";

type JobDetail = { job: JobView; edits: Record<string, UiClipEdit> };
type Props = { detail: JobDetail; onEditSaved: () => void };

const clock = (ms: number) => formatTime(ms).slice(0, -4);

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
  const dirty = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const selected = clips.find((clip) => clip.id === selectedId) ?? clips[0];

  useEffect(() => {
    let active = true;
    void getTranscript(job.id).then((items) => { if (active) setSentences(items); })
      .catch((reason: unknown) => { if (active) setLoadError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [job.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selected) return;
    video.pause();
    const savedEdit = detail.edits[selected.id];
    const savedRange = { startMs: savedEdit?.startMs ?? selected.start, endMs: savedEdit?.endMs ?? selected.end };
    setRange(savedRange);
    setStartText(formatTime(savedRange.startMs));
    setEndText(formatTime(savedRange.endMs));
    dirty.current = false;
    video.currentTime = savedRange.startMs / 1000;
    setPlayhead(savedRange.startMs);
  }, [job.id, selected?.id]);

  useEffect(() => {
    if (!selected || !dirty.current) return;
    setSaveState("Saving…");
    const timer = window.setTimeout(() => {
      void saveClipEdit(job.id, selected.id, {
        startMs: range.startMs,
        endMs: range.endMs,
        caption: detail.edits[selected.id]?.caption ?? "",
        style: detail.edits[selected.id]?.style,
        titleOverlay: detail.edits[selected.id]?.titleOverlay,
        layout: detail.edits[selected.id]?.layout,
      }).then(() => {
        dirty.current = false;
        setSaveState("Saved");
        onEditSaved();
      }).catch((reason: unknown) => {
        setSaveState(reason instanceof Error ? reason.message : String(reason));
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [detail.edits, job.id, onEditSaved, range, selected]);

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

  return <section className="editor-shell" aria-label="Job editor">
    <header className="editor-heading"><div><span className="eyebrow">JOB EDITOR</span><h2>{job.filename}</h2></div><span className={`badge ${job.status}`}>{job.status}</span></header>
    {loadError && <p className="error" role="alert">{loadError}</p>}
    {job.status !== "completed" && <div className="editor-progress"><span>{job.error ? `Failed: ${job.error}` : `${job.stage} · ${job.progress}%`}</span><div className="progress-track"><div className="progress-fill" style={{ width: `${job.progress}%` }} /></div></div>}
    <div className="editor-grid">
      <aside className="editor-column clip-column"><h3>Clips <span>{clips.length}</span></h3>{clips.length ? clips.map((clip) => <button className={`clip-choice ${selected?.id === clip.id ? "active" : ""}`} key={clip.id} onClick={() => setSelectedId(clip.id)}><strong>{clip.title}</strong><span>{clock(clip.duration)} · score {clip.score}/10</span></button>) : <p className="muted">No clips yet.</p>}</aside>
      <section className="editor-column preview-column" aria-label="Source preview">
        {selected ? <>
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
          <p className="preview-caption">{currentSentence?.text ?? selected.hook}</p><p className="preview-note">Preview only, final look is rendered.</p>
          <div className="trim-fields"><label>Start<input value={startText} onChange={(event) => setStartText(event.currentTarget.value)} onBlur={() => commitTimeText("startMs", startText)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label><label>End<input value={endText} onChange={(event) => setEndText(event.currentTarget.value)} onBlur={() => commitTimeText("endMs", endText)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label></div>
          <div className="range-wrap"><input aria-label="Clip start range" type="range" min="0" max={windowSpan} step="100" value={Math.min(windowSpan, Math.max(0, range.startMs - windowStart))} onChange={(event) => updateRange({ ...range, startMs: windowStart + Number(event.currentTarget.value) })} /><input aria-label="Clip end range" type="range" min="0" max={windowSpan} step="100" value={Math.min(windowSpan, Math.max(0, range.endMs - windowStart))} onChange={(event) => updateRange({ ...range, endMs: windowStart + Number(event.currentTarget.value) })} /></div>
          <div className="trim-actions"><button onClick={() => updateRange({ ...range, startMs: playhead })}>Start = playhead</button><button onClick={() => updateRange({ ...range, endMs: playhead })}>End = playhead</button><button onClick={() => updateRange({ ...range, startMs: range.startMs - 100 })}>Start −100 ms</button><button onClick={() => updateRange({ ...range, startMs: range.startMs + 100 })}>Start +100 ms</button><button onClick={() => updateRange({ ...range, endMs: range.endMs - 100 })}>End −100 ms</button><button onClick={() => updateRange({ ...range, endMs: range.endMs + 100 })}>End +100 ms</button><button onClick={() => { if (videoRef.current) videoRef.current.currentTime = range.startMs / 1000; }}>Jump to start</button><button onClick={() => { if (videoRef.current) videoRef.current.currentTime = range.endMs / 1000; }}>Jump to end</button><button onClick={() => updateRange({ startMs: detail.edits[selected.id]?.origStartMs ?? selected.start, endMs: detail.edits[selected.id]?.origEndMs ?? selected.end })}>Reset</button><label><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.currentTarget.checked)} /> Snap to words</label></div>
          <p className="trim-status">Duration {formatTime(range.endMs - range.startMs)} · {saveState}{warning && <span className="warning"> · Outside 30–90 sec</span>}</p>
        </> : <p className="muted">Select a clip to preview.</p>}
      </section>
      <aside className="editor-column transcript-column"><h3>Transcript</h3>{sentences.length ? <div className="transcript-list">{sentences.map((sentence) => <p className={currentSentence?.id === sentence.id ? "current" : ""} key={sentence.id}><span>{clock(sentence.start)}</span>{sentence.text}</p>)}</div> : <p className="muted">Transcript will appear when transcription completes.</p>}</aside>
    </div>
  </section>;
}
