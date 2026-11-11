import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { JobListItem } from "../src/types.ts";
import { getJob, getJobs, uploadVideo } from "./api.ts";

export function App() {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [selectedJob, setSelectedJob] = useState<Awaited<ReturnType<typeof getJob>> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [faceTracking, setFaceTracking] = useState(false);
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const items = await getJobs();
      setJobs(items);
      setError("");
      if (selectedId) {
        const detail = await getJob(selectedId);
        setSelectedJob(detail);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!jobs.some((job) => job.status === "queued" || job.status === "running")) return;
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [jobs, refresh]);

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) { setError("Choose a video file first."); return; }
    setUploading(true);
    setError("");
    try {
      const job = await uploadVideo(file, faceTracking);
      setSelectedId(job.id);
      setSelectedJob({ job, edits: {} });
      setFile(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploading(false);
    }
  }

  return <main className="shell">
    <header className="topbar"><a className="brand" href="/">cutroom<span>.</span></a><span className="local-tag">LOCAL WORKSPACE</span></header>
    <section className="hero"><p className="eyebrow">VIDEO CLIPPER</p><h1>Make the moments<br /><em>worth sharing.</em></h1><p>Turn long videos into short, captioned clips on your computer.</p></section>
    <section className="panel">
      <form className="upload-row" onSubmit={(event) => void submitUpload(event)}>
        <label className="file-picker">{file ? file.name : "Choose a video (MP4, MOV, MKV, WEBM)"}<input key={file?.name ?? "empty"} type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.m4v" onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} /></label>
        <label className="check-option"><input type="checkbox" checked={faceTracking} onChange={(event) => setFaceTracking(event.currentTarget.checked)} /> Track faces</label>
        <button className="button primary" type="submit" disabled={uploading}>{uploading ? "Uploading…" : "Upload video"}</button>
      </form>
      <div className="section-title"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>Recent projects</h2></div><button className="button quiet" onClick={() => void refresh()}>Refresh</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      {loading ? <p className="muted">Loading projects…</p> : jobs.length === 0 ? <p className="muted">No projects yet. Upload a video to get started.</p> : <ul className="job-list">{jobs.map((job) => <li className={`job-row ${selectedId === job.id ? "selected" : ""}`} key={job.id} onClick={() => { setSelectedId(job.id); void getJob(job.id).then(setSelectedJob).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))); }}><div className="job-info"><strong>{job.filename}</strong><span className="muted">{job.stage} · {job.progress}%</span><div className="progress-track"><div className="progress-fill" style={{ width: `${job.progress}%` }} /></div>{job.error && <span className="error">{job.error}</span>}</div><span className={`badge ${job.status}`}>{job.status}</span></li>)}</ul>}
      {selectedJob && <p className="muted selected-summary">Selected: {selectedJob.job.filename} · {selectedJob.job.status}</p>}
    </section>
    <footer>Videos stay on this computer · CPU rendering</footer>
  </main>;
}
