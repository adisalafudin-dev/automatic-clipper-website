import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJobApi } from "./api.ts";
import type { PipelineResult } from "./pipeline/run.ts";
import { JobQueue } from "./state/queue.ts";
import { JobStore } from "./state/jobs.ts";

function fixtureResult(): PipelineResult {
  return {
    manifest: { source: "fixture.mp4", clips: [] },
    transcriptWords: 0,
    candidateCount: 0,
  };
}

async function waitForStatus(baseUrl: string, id: string, status: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await fetch(`${baseUrl}/jobs/${id}`);
    const payload = await response.json() as { job: { status: string } };
    if (payload.job.status === status) return payload.job;
    await Bun.sleep(5);
  }
  throw new Error(`Job ${id} did not reach ${status}`);
}

test("HTTP API accepts jobs, exposes persisted stage progress, and returns results", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "clipper-api-"));
  const input = path.join(temp, "video.mp4");
  await Bun.write(input, "fixture");
  const db = new Database(":memory:");
  const store = new JobStore(db);
  const queue = new JobQueue(store, async () => {
    await Bun.sleep(5);
    return fixtureResult();
  });
  const app = createJobApi(store, queue);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  try {
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const invalid = await fetch(`${baseUrl}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoPath: "   " }),
    });
    expect(invalid.status).toBe(400);

    const missing = await fetch(`${baseUrl}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoPath: path.join(temp, "missing.mp4") }),
    });
    expect(missing.status).toBe(400);

    const created = await fetch(`${baseUrl}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoPath: input }),
    });
    expect(created.status).toBe(202);
    const { job: queued } = await created.json() as { job: { id: string; status: string } };
    expect(queued.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(["queued", "running", "completed"]).toContain(queued.status);

    const completed = await waitForStatus(baseUrl, queued.id, "completed");
    const detailed = await fetch(`${baseUrl}/jobs/${queued.id}`);
    const { job } = await detailed.json() as { job: { progress: number; stage: string; stages: Record<string, { status: string; progress: number }>; result: { clips: unknown[] } } };
    expect(job.stage).toBe("complete");
    expect(job.progress).toBe(100);
    expect(Object.values(job.stages).every((stage) => stage.status === "completed" && stage.progress === 100)).toBe(true);
    expect(job.result.clips).toEqual([]);
    expect(completed.status).toBe("completed");

    const list = await fetch(`${baseUrl}/jobs?limit=10`);
    const { jobs } = await list.json() as { jobs: Array<{ id: string }> };
    expect(jobs.some((item) => item.id === queued.id)).toBe(true);
    expect((await fetch(`${baseUrl}/jobs/not-a-job`)).status).toBe(404);
  } finally {
    server.stop?.();
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("in-process queue processes jobs one at a time", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "clipper-queue-"));
  const inputA = path.join(temp, "a.mp4");
  const inputB = path.join(temp, "b.mp4");
  await Promise.all([Bun.write(inputA, "a"), Bun.write(inputB, "b")]);
  const db = new Database(":memory:");
  const store = new JobStore(db);
  let active = 0;
  let maximumActive = 0;
  const order: string[] = [];
  const queue = new JobQueue(store, async (videoPath, _jobDir, _force, report) => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    order.push(path.basename(videoPath));
    report("transcription", 0);
    await Bun.sleep(25);
    report("transcription", 100);
    active--;
    return fixtureResult();
  });
  const app = createJobApi(store, queue);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  try {
    const ids: string[] = [];
    for (const videoPath of [inputA, inputB]) {
      const response = await fetch(`${baseUrl}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoPath }),
      });
      const body = await response.json() as { job: { id: string } };
      ids.push(body.job.id);
    }
    await Promise.all(ids.map((id) => waitForStatus(baseUrl, id, "completed")));
    expect(maximumActive).toBe(1);
    expect(order).toEqual(["a.mp4", "b.mp4"]);
  } finally {
    server.stop?.();
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("pipeline errors are persisted as failed jobs", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "clipper-failed-job-"));
  const input = path.join(temp, "video.mp4");
  await Bun.write(input, "fixture");
  const db = new Database(":memory:");
  const store = new JobStore(db);
  const queue = new JobQueue(store, async (_video, _jobDir, _force, report) => {
    report("transcription", 0);
    throw new Error("Transcription failed");
  });
  const app = createJobApi(store, queue);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoPath: input }),
    });
    const { job } = await response.json() as { job: { id: string } };
    await waitForStatus(`http://127.0.0.1:${server.port}`, job.id, "failed");
    const failed = store.get(job.id)!;
    expect(failed.error).toBe("Transcription failed");
    expect(failed.stages.transcription.status).toBe("failed");
  } finally {
    server.stop?.();
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
