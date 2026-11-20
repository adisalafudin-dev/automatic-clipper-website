import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ModeName, ModeProfile } from "../src/modes.ts";
import { cancelYouTubeAnalysis, createYouTubeProject, getModes, getYouTubeAnalysis, startYouTubeAnalysis, type YouTubeAnalysisView } from "./api.ts";

type DownloadJob = { id: string; status: "running" | "completed" | "failed" | "cancelled"; progress: number; filename?: string; error?: string };
type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{
    createWritable: () => Promise<WritableStream<Uint8Array>>;
  }>;
};

export function YouTubeDownloader({ onProjectCreated }: { onProjectCreated: (id: string) => void }) {
  const [url, setUrl] = useState("");
  const [analysisUrl, setAnalysisUrl] = useState("");
  const [start, setStart] = useState("03:00:00");
  const [end, setEnd] = useState("03:35:00");
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [analysis, setAnalysis] = useState<YouTubeAnalysisView | null>(null);
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [modes, setModes] = useState<ModeProfile[]>([]);
  const [mode, setMode] = useState<ModeName>("default");
  const [faceTracking, setFaceTracking] = useState(false);
  const [autoDetectFacecam, setAutoDetectFacecam] = useState(true);
  const [facecamRect, setFacecamRect] = useState("0.70,0.70,0.30,0.30");
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const createdProjectRef = useRef("");

  useEffect(() => { void getModes().then(setModes).catch(() => {}); }, []);

  useEffect(() => {
    if (!analysis || (analysis.status !== "running" && analysis.status !== "creating")) return;
    let active = true;
    const timer = window.setInterval(() => {
      void getYouTubeAnalysis(analysis.id).then((updated) => {
        if (!active) return;
        setAnalysis(updated);
        if (updated.projectId && createdProjectRef.current !== updated.projectId) {
          createdProjectRef.current = updated.projectId;
          onProjectCreated(updated.projectId);
        }
        if (updated.status === "completed" && updated.result && selectedCandidates.length === 0) {
          setSelectedCandidates(updated.result.candidates.map((candidate) => candidate.id).slice(0, 10));
        }
      }).catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    }, 1_500);
    return () => { active = false; window.clearInterval(timer); };
  }, [analysis?.id, analysis?.status, onProjectCreated, selectedCandidates.length]);

  async function analyzeVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setAnalysis(null); setSelectedCandidates([]); createdProjectRef.current = "";
    try { setAnalysis(await startYouTubeAnalysis(analysisUrl)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function makeClips() {
    if (!analysis || !selectedCandidates.length) return;
    setError("");
    try {
      setAnalysis(await createYouTubeProject(analysis.id, { candidateIds: selectedCandidates, mode, faceTracking, captionsEnabled, ...(!autoDetectFacecam && mode === "gaming" ? { facecamRect } : {}) }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function cancelAnalysis() {
    if (!analysis) return;
    try {
      await cancelYouTubeAnalysis(analysis.id);
      setAnalysis({ ...analysis, status: "cancelled", stage: "Cancelled" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  useEffect(() => {
    if (!job || job.status !== "running") return;
    let active = true;
    const timer = window.setInterval(() => {
      void fetch(`/youtube-downloads/${encodeURIComponent(job.id)}`).then(async (response) => {
        const body = await response.json() as { job?: DownloadJob; error?: string };
        if (active && response.ok && body.job) setJob(body.job);
      }).catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    }, 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [job?.id, job?.status]);

  async function startDownload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setJob(null);
    try {
      const response = await fetch("/youtube-downloads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, start, end }),
      });
      const body = await response.json() as { job?: DownloadJob; error?: string };
      if (!response.ok || !body.job) throw new Error(body.error ?? "Could not start the download");
      setJob(body.job);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function cancelDownload() {
    if (!job) return;
    await fetch(`/youtube-downloads/${encodeURIComponent(job.id)}`, { method: "DELETE" });
    setJob({ ...job, status: "cancelled" });
  }

  async function discardDownload() {
    if (!job) return;
    await fetch(`/youtube-downloads/${encodeURIComponent(job.id)}`, { method: "DELETE" });
    setJob(null);
  }

  async function saveFile() {
    if (!job?.filename) return;
    setSaving(true);
    setError("");
    try {
      const saveWindow = window as SavePickerWindow;
      if (!saveWindow.showSaveFilePicker) {
        const anchor = document.createElement("a");
        anchor.href = `/youtube-downloads/${encodeURIComponent(job.id)}/file`;
        anchor.download = job.filename;
        anchor.click();
        return;
      }
      const handle = await saveWindow.showSaveFilePicker({ suggestedName: job.filename });
      const response = await fetch(`/youtube-downloads/${encodeURIComponent(job.id)}/file`);
      if (!response.ok || !response.body) throw new Error("Could not read the finished video");
      await response.body.pipeTo(await handle.createWritable());
      await fetch(`/youtube-downloads/${encodeURIComponent(job.id)}`, { method: "DELETE" });
      setJob(null);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  return <>
  <section className="panel youtube-panel youtube-ai-panel">
    <div className="section-title"><div><p className="eyebrow">AI CLIP FINDER</p><h2>Find moments from a YouTube stream</h2></div></div>
    <p className="muted">Analyze captions, replay chat, and YouTube's replay heatmap without downloading the full video. 9Router receives transcript snippets and activity summaries, never video or raw chat logs.</p>
    <form className="youtube-form" onSubmit={(event) => void analyzeVideo(event)}>
      <label className="language-option youtube-url"><span>YouTube video or completed livestream replay</span><input type="url" required value={analysisUrl} onChange={(event) => setAnalysisUrl(event.currentTarget.value)} placeholder="https://www.youtube.com/watch?v=…" disabled={analysis?.status === "running" || analysis?.status === "creating"} /></label>
      <p className="muted">If captions are unavailable, the app downloads audio only (estimated limit 500 MB) and transcribes it locally. Live chat replay and heatmap are optional signals.</p>
      <button className="button primary" type="submit" disabled={analysis?.status === "running" || analysis?.status === "creating"}>{analysis?.status === "running" ? "Analyzing…" : "Analyze for clips"}</button>
    </form>
    {(analysis?.status === "running" || analysis?.status === "creating") && <div className="download-progress"><span>{analysis.stage} · {analysis.progress}%</span><div className="progress-track"><div className="progress-fill" style={{ width: `${analysis.progress}%` }} /></div><button className="button danger" onClick={() => void cancelAnalysis()}>Cancel</button></div>}
    {analysis?.status === "failed" && <p className="error" role="alert">Analysis failed: {analysis.error}</p>}
    {analysis?.status === "cancelled" && <p className="muted">Analysis cancelled.</p>}
    {analysis?.result && analysis.status === "completed" && <div className="youtube-analysis-results">
      <div className="youtube-analysis-heading"><div><strong>{analysis.result.title}</strong><small>{analysis.result.channel} · {timeline(analysis.result.duration)} · {analysis.result.language} captions</small></div><span>{analysis.result.signals.windows.some((window) => window.chatCount > 0) ? "Chat replay" : "No chat replay"} · {analysis.result.signals.windows.some((window) => window.heatmapScore > 0) ? "Heatmap" : "No heatmap"}</span></div>
      <p className="muted">Choose up to 10 AI-ranked moments. Selected sections are downloaded individually, joined locally, and then rendered as a project.</p>
      {analysis.result.warnings.length > 0 && <p className="muted">Some high-activity windows could not be scored; remaining moments are shown.</p>}
      <div className="youtube-candidate-list">{analysis.result.candidates.map((candidate) => {
        const selected = selectedCandidates.includes(candidate.id);
        const samples = analysis.result!.signals.windows.filter((window) => window.start < candidate.end && window.end > candidate.start && window.samples.length).flatMap((window) => window.samples).slice(0, 2);
        return <label className={`youtube-candidate ${selected ? "selected" : ""}`} key={candidate.id}><input type="checkbox" checked={selected} onChange={(event) => { const checked = event.currentTarget.checked; setSelectedCandidates((current) => checked ? [...current, candidate.id].slice(0, 10) : current.filter((id) => id !== candidate.id)); }} /><span className="youtube-candidate-main"><span className="youtube-candidate-title"><strong>{candidate.title}</strong><b>{candidate.score.toFixed(1)}/10</b></span><small>{timeline(candidate.start)}–{timeline(candidate.end)} · {timeline(candidate.end - candidate.start)}</small><span>{candidate.hook}</span><small>{candidate.reason}</small>{candidate.signalScores && <small className="activity-summary">Chat {candidate.signalScores.chat.toFixed(1)}/10 · Replay {candidate.signalScores.heatmap.toFixed(1)}/10</small>}{samples.map((sample, index) => <small className="chat-sample" key={index}>“{sample}”</small>)}</span></label>;
      })}</div>
      <div className="youtube-create-settings"><label className="form-field"><span>Render mode</span><select value={mode} onChange={(event) => setMode(event.currentTarget.value as ModeName)}>{modes.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select></label>{mode === "gaming" && <label className="upload-option"><input type="checkbox" checked={autoDetectFacecam} onChange={(event) => setAutoDetectFacecam(event.currentTarget.checked)} /><span><strong>Auto-detect facecam</strong><small>Find the camera region; uncheck for manual placement</small></span></label>}{mode === "gaming" && !autoDetectFacecam && <label className="form-field"><span>Facecam x,y,w,h</span><input value={facecamRect} onChange={(event) => setFacecamRect(event.currentTarget.value)} aria-label="Facecam rectangle normalized x,y,w,h" /></label>}<label className="upload-option"><input type="checkbox" checked={faceTracking} onChange={(event) => setFaceTracking(event.currentTarget.checked)} /><span><strong>Track faces</strong><small>Keep the speaker in frame</small></span></label><label className="upload-option"><input type="checkbox" checked={captionsEnabled} onChange={(event) => setCaptionsEnabled(event.currentTarget.checked)} /><span><strong>Add subtitles</strong><small>Burn captions into clips</small></span></label><button className="button primary" disabled={!selectedCandidates.length} onClick={() => void makeClips()}>Download & render {selectedCandidates.length} clip{selectedCandidates.length === 1 ? "" : "s"}</button></div>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="youtube-legal">Use only videos you own or have permission to process. Analysis accepts completed videos and livestream replays; active live streams are not supported.</p>
  </section>
  <section className="panel youtube-panel">
    <div className="section-title"><div><p className="eyebrow">YOUTUBE DOWNLOAD</p><h2>Download a video clip</h2></div></div>
    <p className="muted">Download one section at up to 1080p, then choose where to save the MP4 on your computer.</p>
    <form className="youtube-form" onSubmit={(event) => void startDownload(event)}>
      <label className="language-option youtube-url"><span>YouTube link</span><input type="url" required value={url} onChange={(event) => setUrl(event.currentTarget.value)} placeholder="https://www.youtube.com/watch?v=…" disabled={job?.status === "running"} /></label>
      <div className="youtube-times"><label className="language-option"><span>Start (HH:MM:SS)</span><input value={start} onChange={(event) => setStart(event.currentTarget.value)} pattern="[0-9]{2,}:[0-5][0-9]:[0-5][0-9]" required disabled={job?.status === "running"} /></label><label className="language-option"><span>End (HH:MM:SS)</span><input value={end} onChange={(event) => setEnd(event.currentTarget.value)} pattern="[0-9]{2,}:[0-5][0-9]:[0-5][0-9]" required disabled={job?.status === "running"} /></label></div>
      <p className="muted">Uses H.264 video up to 1080p and M4A audio, merged as MP4.</p>
      <button className="button primary" type="submit" disabled={job?.status === "running"}>{job?.status === "running" ? "Downloading…" : "Download section"}</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {job?.status === "running" && <div className="download-progress"><span>Downloading · {Math.floor(job.progress)}%</span><div className="progress-track"><div className="progress-fill" style={{ width: `${job.progress}%` }} /></div><button className="button danger" onClick={() => void cancelDownload()}>Cancel</button></div>}
    {job?.status === "completed" && <div className="download-result"><span>{job.filename}</span><div className="download-actions"><button className="button primary" disabled={saving} onClick={() => void saveFile()}>{saving ? "Saving…" : "Choose save location…"}</button><button className="button danger" disabled={saving} onClick={() => void discardDownload()}>Discard</button></div></div>}
    {job?.status === "failed" && <p className="error" role="alert">Download failed: {job.error}</p>}
    {job?.status === "cancelled" && <p className="muted">Download cancelled.</p>}
    <p className="youtube-legal">Use only videos you own or have permission to download. One video at a time; no bulk downloads.</p>
  </section>
  </>;
}

function timeline(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
