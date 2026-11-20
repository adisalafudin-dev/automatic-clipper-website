import { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from "react";
import type { JobListItem } from "../src/types.ts";
import type { ModeName, ModeProfile } from "../src/modes.ts";
import { cancelJob, deleteJob, getJob, getJobs, getModes, retryJob, uploadVideo } from "./api.ts";
import { JobEditor } from "./JobEditor.tsx";
import { YouTubeDownloader } from "./YouTubeDownloader.tsx";
import { LlmSettings } from "./LlmSettings.tsx";

export function App() {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [selectedJob, setSelectedJob] = useState<Awaited<ReturnType<typeof getJob>> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState("");
  const [faceTracking, setFaceTracking] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [mode, setMode] = useState<ModeName>("default");
  const [autoDetectFacecam, setAutoDetectFacecam] = useState(true);
  const [facecamRect, setFacecamRect] = useState("0.70,0.70,0.30,0.30");
  const [modes, setModes] = useState<ModeProfile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [page, setPage] = useState<"clips" | "youtube" | "settings">("clips");

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

  const openYouTubeProject = useCallback((id: string) => {
    setPage("clips");
    setSelectedId(id);
    void getJob(id).then(setSelectedJob).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    void getJobs().then(setJobs).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    void getModes().then(setModes).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);
  useEffect(() => {
    if (!jobs.some((job) => job.status === "queued" || job.status === "running")) return;
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [jobs, refresh]);

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) { setError("Choose a video file first."); return; }
    setUploading(true);
    setUploadProgress(0);
    setError("");
    try {
      const manualFacecamRect = mode === "gaming" && !autoDetectFacecam ? facecamRect : undefined;
      const job = await uploadVideo(file, faceTracking, "auto", mode, manualFacecamRect, projectName, captionsEnabled, setUploadProgress);
      setSelectedId(job.id);
      setSelectedJob({ job, edits: {}, feedback: {} });
      setFile(null);
      setProjectName("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  async function stopJob(event: MouseEvent<HTMLButtonElement>, jobId: string) {
    event.stopPropagation();
    try {
      await cancelJob(jobId);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function removeProject(event: MouseEvent<HTMLButtonElement>, project: JobListItem) {
    event.stopPropagation();
    const confirmed = window.confirm(`Delete project "${project.filename}"? This removes its clips and project data. An uploaded source video is deleted too; a video selected from another folder is kept.`);
    if (!confirmed) return;
    try {
      await deleteJob(project.id);
      if (selectedId === project.id) {
        setSelectedId("");
        setSelectedJob(null);
      }
      setJobs(await getJobs());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function retryProject(event: MouseEvent<HTMLButtonElement>, project: JobListItem) {
    event.stopPropagation();
    try {
      await retryJob(project.id);
      setSelectedId(project.id);
      setSelectedJob(await getJob(project.id));
      setJobs(await getJobs());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return <main className="shell">
    <header className="topbar"><a className="brand" href="/">cutroom<span>.</span></a><span className="local-tag">LOCAL WORKSPACE</span></header>
    <nav className="page-tabs" aria-label="Main pages"><button className={page === "clips" ? "active" : ""} disabled={uploading} onClick={() => setPage("clips")}>Clipper</button><button className={page === "youtube" ? "active" : ""} disabled={uploading} onClick={() => setPage("youtube")}>YouTube download</button><button className={page === "settings" ? "active" : ""} disabled={uploading} onClick={() => setPage("settings")}>Settings</button></nav>
    {page === "youtube" ? <YouTubeDownloader onProjectCreated={openYouTubeProject} /> : page === "settings" ? <section className="settings-page"><div className="settings-page-heading"><p className="eyebrow">PREFERENCES</p><h1>Settings</h1><p>Configure the connection used for clip selection and metadata.</p></div><LlmSettings standalone /></section> : <>
    <section className="hero"><p className="eyebrow">VIDEO CLIPPER</p><h1>Make the moments<br /><em>worth sharing.</em></h1><p>Turn long videos into short clips on your computer, with optional subtitles.</p></section>
    <section className="panel">
      <form className="upload-form" onSubmit={(event) => void submitUpload(event)}>
        <label className={`file-picker ${file ? "has-file" : ""}`}>
          <span className="file-picker-copy"><strong>{file ? file.name : "Choose a video to get started"}</strong><small>{file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB · Ready to upload` : "MP4, MOV, MKV, or WEBM · Up to 2 GB"}</small></span>
          <span className="file-picker-button">Browse files</span>
          <input key={file?.name ?? "empty"} aria-label="Choose a video file" type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.m4v" disabled={uploading} onChange={(event) => { const selected = event.currentTarget.files?.[0] ?? null; setFile(selected); setProjectName(selected?.name.replace(/\.[^.]+$/, "") ?? ""); }} />
        </label>
        <div className="upload-settings">
          <label className="form-field"><span>Project name</span><input value={projectName} maxLength={100} disabled={uploading} onChange={(event) => setProjectName(event.currentTarget.value)} placeholder="Name this video" /></label>
          <label className="form-field"><span>Mode</span><select value={mode} disabled={uploading} onChange={(event) => setMode(event.currentTarget.value as ModeName)}>{modes.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select></label>
          {mode === "gaming" && !autoDetectFacecam && <label className="form-field"><span>Facecam x,y,w,h</span><input value={facecamRect} disabled={uploading} onChange={(event) => setFacecamRect(event.currentTarget.value)} aria-label="Facecam rectangle normalized x,y,w,h" /></label>}
        </div>
        <div className="upload-options">
          {mode === "gaming" && <label className="upload-option"><input type="checkbox" checked={autoDetectFacecam} disabled={uploading} onChange={(event) => setAutoDetectFacecam(event.currentTarget.checked)} /><span><strong>Auto-detect facecam</strong><small>Find the camera region in each clip; uncheck to set it manually</small></span></label>}
          <label className="upload-option"><input type="checkbox" checked={faceTracking} disabled={uploading} onChange={(event) => setFaceTracking(event.currentTarget.checked)} /><span><strong>Track faces</strong><small>Keep the speaker in frame</small></span></label>
          <label className="upload-option"><input type="checkbox" checked={captionsEnabled} disabled={uploading} onChange={(event) => setCaptionsEnabled(event.currentTarget.checked)} /><span><strong>Add subtitles</strong><small>Burn captions into the clips</small></span></label>
        </div>
        <div className="upload-submit"><p>Clips are selected and rendered automatically after upload.</p><button className="button primary" type="submit" disabled={uploading || !file}>{uploading ? "Uploading…" : "Upload and create clips"}</button></div>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
        {uploading && <div className="upload-progress" role="status" aria-live="polite"><div className="upload-progress-label"><span>{uploadProgress >= 100 ? "Upload complete · starting processing" : "Uploading video"}</span><span>{uploadProgress}%</span></div><div className="upload-progress-track" role="progressbar" aria-label="Video upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}><div style={{ width: `${uploadProgress}%` }} /></div><small>{uploadProgress >= 100 ? "Your project will appear below." : "Keep this page open while the video uploads."}</small></div>}
      <div className="section-title"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>Recent projects</h2></div><button className="button quiet" onClick={() => void refresh()}>Refresh</button></div>
      {loading ? <p className="muted">Loading projects…</p> : jobs.length === 0 ? <p className="muted">No projects yet. Upload a video to get started.</p> : <ul className="job-list">{jobs.map((job) => <li className={`job-row ${selectedId === job.id ? "selected" : ""}`} key={job.id} onClick={() => { setSelectedId(job.id); void getJob(job.id).then(setSelectedJob).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))); }}><div className="job-info"><strong>{job.filename}</strong><span className="muted">{job.stage} · {job.progress}%</span><div className="progress-track"><div className="progress-fill" style={{ width: `${job.progress}%` }} /></div>{job.error && <span className="error">{job.error}</span>}</div><div className="job-actions"><span className={`badge ${job.status}`}>{job.status}</span>{job.status === "failed" && <button className="button" type="button" onClick={(event) => void retryProject(event, job)}>Retry</button>}{(job.status === "queued" || job.status === "running") && <button className="button danger" type="button" onClick={(event) => void stopJob(event, job.id)}>Cancel</button>}<button className="button danger" type="button" aria-label={`Delete project ${job.filename}`} onClick={(event) => void removeProject(event, job)}>Delete</button></div></li>)}</ul>}
      {selectedJob && <JobEditor detail={selectedJob} onEditSaved={refresh} />}
    </section>
    </>}
    <footer>Videos stay on this computer · CPU rendering</footer>
  </main>;
}
