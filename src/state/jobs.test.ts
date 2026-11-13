import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { JobStore } from "./jobs.ts";

test("existing Phase 5 job databases migrate to store the face tracking setting", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE jobs (
      id TEXT PRIMARY KEY, video_path TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
      stage TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, stages_json TEXT NOT NULL,
      error TEXT, result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    const now = new Date().toISOString();
    db.query("INSERT INTO jobs (id, video_path, status, stage, stages_json, created_at, updated_at) VALUES (?, ?, 'queued', 'queued', ?, ?, ?)")
      .run("legacy-job", "legacy.mp4", "{}", now, now);
    const store = new JobStore(db);
    expect(store.get("legacy-job")?.videoPath).toBe("legacy.mp4");
    const job = store.create("face-track-job", "local-video.mp4", true);
    expect(job.faceTracking).toBe(true);
    expect(job.language).toBe("en");
    expect(job.mode).toBe("default");
    expect(store.create("center-job", "local-video.mp4").faceTracking).toBe(false);
    expect(store.create("indonesian-job", "local-video.mp4", false, "id").language).toBe("id");
    expect(store.create("gaming-job", "local-video.mp4", false, "en", "gaming").mode).toBe("gaming");
  } finally {
    db.close();
  }
});

test("cancelling a queued or running job persists a cancelled state", () => {
  const db = new Database(":memory:");
  try {
    const store = new JobStore(db);
    store.create("cancel-queued", "queued.mp4");
    store.cancel("cancel-queued");
    expect(store.get("cancel-queued")?.status).toBe("cancelled");
    const running = store.create("cancel-running", "running.mp4");
    store.markRunning(running.id);
    store.updateProgress(running.id, "transcription", 25);
    store.cancel(running.id);
    expect(store.get(running.id)?.stages.transcription.status).toBe("cancelled");
    expect(store.get(running.id)?.error).toBe("Cancelled by user");
  } finally {
    db.close();
  }
});
