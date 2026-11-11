import { useEffect, useMemo, useRef, useState } from "react";
import type { JobView, UiClipEdit, UiSentence } from "../src/types.ts";
import { getTranscript } from "./api.ts";

type JobDetail = { job: JobView; edits: Record<string, UiClipEdit> };
type Props = { detail: JobDetail };

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function JobEditor({ detail }: Props) {
  const { job } = detail;
  const clips = job.result?.clips ?? [];
  const [selectedId, setSelectedId] = useState(clips[0]?.id ?? "");
  const [sentences, setSentences] = useState<UiSentence[]>([]);
  const [loop, setLoop] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [loadError, setLoadError] = useState("");
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
    video.currentTime = selected.start / 1000;
    setPlayhead(selected.start);
  }, [job.id, selected?.id]);

  const currentSentence = useMemo(() => sentences.find((sentence) => playhead >= sentence.start && playhead <= sentence.end), [sentences, playhead]);
  const videoUrl = `/jobs/${encodeURIComponent(job.id)}/source`;

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
            if (time >= selected.end) {
              event.currentTarget.pause();
              event.currentTarget.currentTime = loop ? selected.start / 1000 : selected.end / 1000;
              setPlayhead(loop ? selected.start : selected.end);
            }
          }} onPlay={(event) => {
            const time = event.currentTarget.currentTime * 1000;
            if (time < selected.start || time >= selected.end) event.currentTarget.currentTime = selected.start / 1000;
          }} /></div>
          <div className="preview-tools"><label><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.currentTarget.checked)} /> Loop preview</label><span>{clock(selected.start)}–{clock(selected.end)}</span></div>
          <p className="preview-caption">{currentSentence?.text ?? selected.hook}</p><p className="preview-note">Preview only, final look is rendered.</p>
        </> : <p className="muted">Select a clip to preview.</p>}
      </section>
      <aside className="editor-column transcript-column"><h3>Transcript</h3>{sentences.length ? <div className="transcript-list">{sentences.map((sentence) => <p className={currentSentence?.id === sentence.id ? "current" : ""} key={sentence.id}><span>{clock(sentence.start)}</span>{sentence.text}</p>)}</div> : <p className="muted">Transcript will appear when transcription completes.</p>}</aside>
    </div>
  </section>;
}
