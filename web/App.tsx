import { useEffect, useState } from "react";
import type { JobListItem } from "../src/types.ts";
import { getJobs } from "./api.ts";

export function App() {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void getJobs().then((items) => {
      if (active) setJobs(items);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  return <main className="shell">
    <header className="topbar"><a className="brand" href="/">cutroom<span>.</span></a><span className="local-tag">LOCAL WORKSPACE</span></header>
    <section className="hero"><p className="eyebrow">VIDEO CLIPPER</p><h1>Make the moments<br /><em>worth sharing.</em></h1><p>Turn long videos into short, captioned clips on your computer.</p></section>
    <section className="panel">
      <div className="section-title"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>Recent projects</h2></div><button className="button quiet" onClick={() => void getJobs().then(setJobs).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))}>Refresh</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      {loading ? <p className="muted">Loading projects…</p> : jobs.length === 0 ? <p className="muted">No projects yet. Upload a video to get started.</p> : <ul className="job-list">{jobs.map((job) => <li className="job-row" key={job.id}><div><strong>{job.filename}</strong><span className="muted">{job.stage} · {job.progress}%</span></div><span className={`badge ${job.status}`}>{job.status}</span></li>)}</ul>}
    </section>
    <footer>Videos stay on this computer · CPU rendering</footer>
  </main>;
}
