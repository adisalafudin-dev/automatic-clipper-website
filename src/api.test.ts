import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJobApi } from "./api.ts";
import type { PipelineResult } from "./pipeline/run.ts";
import { JobQueue } from "./state/queue.ts";
import { JobStore } from "./state/jobs.ts";
import type { ClipCandidate } from "./pipeline/candidates.ts";

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

test("transcript endpoint stays available while transcription has not produced a file", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "clipper-pending-transcript-"));
  const sourcePath = path.join(temp, "source.mp4");
  await Bun.write(sourcePath, "fixture");
  const db = new Database(":memory:");
  const store = new JobStore(db);
  const job = store.create("pending-transcript", sourcePath);
  const queue = new JobQueue(store, async () => fixtureResult());
  const app = createJobApi(store, queue, { jobRoot: path.join(temp, "jobs") });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/jobs/${job.id}/transcript`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sentences: [] });
  } finally {
    server.stop(true);
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("UI endpoints serve byte ranges, transcript sentences, and create, render, and delete clips", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "clipper-ui-api-"));
  const jobId = "ui-job";
  const sourcePath = path.join(temp, "source.mp4");
  const jobDir = path.join(temp, "jobs", jobId);
  await mkdir(path.join(jobDir, "clips"), { recursive: true });
  await mkdir(path.join(jobDir, "captions"), { recursive: true });
  await Bun.write(sourcePath, new Uint8Array([97, 98, 99, 100, 101, 102]));
  await Bun.write(path.join(jobDir, "clips", "clip-01.mp4"), new Uint8Array([49, 50, 51, 52]));
  await Bun.write(path.join(jobDir, "transcript.json"), JSON.stringify({
    model: "test", language: "en", words: [
      { text: "First", start: 0, end: 15_000 },
      { text: "sentence.", start: 15_500, end: 31_000 },
    ],
  }));
  const initial: ClipCandidate = {
    id: "clip-01", startSentenceId: 0, endSentenceId: 0, start: 0, end: 31_000,
    hook: "Existing", title: "Existing clip", score: 8, reason: "Fixture",
  };
  await Bun.write(path.join(jobDir, "candidates.json"), JSON.stringify([initial]));
  const db = new Database(":memory:");
  const store = new JobStore(db);
  store.create(jobId, sourcePath);
  const rendered = {
    id: "clip-01", file: "clips/clip-01.mp4", captions: "captions/clip-01.ass", start: 0, end: 31_000,
    duration: 31_000, startSentenceId: 0, endSentenceId: 0, title: "Existing clip", hook: "Existing", score: 8, reason: "Fixture",
  };
  store.complete(jobId, { source: sourcePath, clips: [rendered] });
  const queue = new JobQueue(store, async () => fixtureResult(), async (videoPath, _jobDir, report, _faceTracking, clipId) => {
    report("rendering", 100);
    const resultClip = { ...rendered, id: clipId ?? rendered.id, title: "New clip", startSentenceId: 0, endSentenceId: 0 };
    return { manifest: { source: videoPath, clips: [resultClip] }, transcriptWords: 2, candidateCount: 1 };
  }, path.join(temp, "jobs"));
  const app = createJobApi(store, queue, { jobRoot: path.join(temp, "jobs") });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  try {
    const source = await fetch(`${baseUrl}/jobs/${jobId}/source`, { headers: { range: "bytes=1-3" } });
    expect(source.status).toBe(206);
    expect(source.headers.get("content-range")).toBe("bytes 1-3/6");
    expect(await source.text()).toBe("bcd");
    const badRange = await fetch(`${baseUrl}/jobs/${jobId}/source`, { headers: { range: "bytes=9-10" } });
    expect(badRange.status).toBe(416);

    const transcript = await fetch(`${baseUrl}/jobs/${jobId}/transcript`);
    const transcriptBody = await transcript.json() as { sentences: Array<{ id: number; start: number; end: number; words: Array<{ wordIndex: number }> }> };
    expect(transcriptBody.sentences).toHaveLength(1);
    expect(transcriptBody.sentences[0]).toMatchObject({ id: 0, start: 0, end: 31_000 });
    expect(transcriptBody.sentences[0]!.words).toHaveLength(2);
    expect(transcriptBody.sentences[0]!.words[0]!.wordIndex).toBe(0);

    const clipFile = await fetch(`${baseUrl}/jobs/${jobId}/clips/clip-01/file`, { headers: { range: "bytes=1-2" } });
    expect(clipFile.status).toBe(206);
    expect(await clipFile.text()).toBe("23");

    const created = await fetch(`${baseUrl}/jobs/${jobId}/clips`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ startMs: 1_000, endMs: 30_000 }),
    });
    expect(created.status).toBe(201);
    expect((await created.json() as { clip: { id: string } }).clip.id).toBe("clip-02");

    const render = await fetch(`${baseUrl}/jobs/${jobId}/clips/clip-02/render`, { method: "POST" });
    expect(render.status).toBe(202);
    await waitForStatus(baseUrl, jobId, "completed");
    expect(store.get(jobId)!.result!.clips.map((clip) => clip.id)).toEqual(["clip-01", "clip-02"]);
    const renderState = await fetch(`${baseUrl}/jobs/${jobId}`);
    const renderBody = await renderState.json() as { edits: Record<string, { renderStatus: string; renderedAt?: string }> };
    expect(renderBody.edits["clip-02"]!.renderStatus).toBe("done");
    expect(typeof renderBody.edits["clip-02"]!.renderedAt).toBe("string");

    const deleted = await fetch(`${baseUrl}/jobs/${jobId}/clips/clip-01`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(store.get(jobId)!.result!.clips.map((clip) => clip.id)).toEqual(["clip-02"]);
  } finally {
    server.stop(true);
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

test("browser upload supports preview, trim and caption edits, and queued rerender", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "clipper-ui-api-"));
  const db = new Database(":memory:");
  const store = new JobStore(db);
  const clip = {
    id: "clip-01", file: "clips/clip-01.mp4", captions: "captions/clip-01.ass",
    start: 0, end: 30_000, duration: 30_000, startSentenceId: 1, endSentenceId: 1,
    title: "Test highlight", hook: "A clean test hook", score: 8, reason: "Fixture",
  };
  const result: PipelineResult = {
    manifest: { source: "uploaded.mp4", clips: [clip] }, transcriptWords: 1, candidateCount: 1,
  };
  let renderCount = 0;
  let faceTrackingRequested = false;
  let rerenderFaceTracking = false;
  let rerenderOnlyStale = false;
  const queue = new JobQueue(store, async (videoPath, jobDir, _force, _report, options) => {
    faceTrackingRequested = options.faceTracking === true;
    await mkdir(path.join(jobDir, "clips"), { recursive: true });
    await Bun.write(path.join(jobDir, "transcript.json"), JSON.stringify({
      model: "fixture", language: "en", words: [{ text: "hello", start: 0, end: 35_000 }],
    }));
    await Bun.write(path.join(jobDir, "candidates.json"), JSON.stringify([{
      startSentenceId: 1, endSentenceId: 1, hook: clip.hook, title: clip.title,
      score: clip.score, reason: clip.reason, start: 0, end: 30_000,
    }]));
    await Bun.write(path.join(jobDir, clip.file), "fixture clip");
    return { ...result, manifest: { ...result.manifest, source: videoPath } };
  }, async (videoPath, _jobDir, report, faceTracking, _clipId, onlyStale) => {
    renderCount++;
    rerenderFaceTracking = faceTracking;
    rerenderOnlyStale = onlyStale === true;
    report("rendering", 0);
    await Bun.sleep(10);
    report("rendering", 100);
    return { ...result, manifest: { ...result.manifest, source: videoPath } };
  }, path.join(temp, "jobs"));
  const app = createJobApi(store, queue, {
    uploadDir: path.join(temp, "uploads"), jobRoot: path.join(temp, "jobs"),
  });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  try {
    const upload = await fetch(`${baseUrl}/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-video-filename": "uploaded.mp4",
        "x-face-tracking": "true",
      },
      body: new File(["source video"], "uploaded.mp4", { type: "video/mp4" }),
    });
    expect(upload.status).toBe(202);
    const { job: created } = await upload.json() as { job: { id: string; videoPath: string } };
    await waitForStatus(baseUrl, created.id, "completed");
    expect(store.get(created.id)!.faceTracking).toBe(true);
    expect(faceTrackingRequested).toBe(true);
    expect(await Bun.file(created.videoPath).text()).toBe("source video");

    const preview = await fetch(`${baseUrl}/jobs/${created.id}/clips/clip-01`);
    expect(preview.status).toBe(200);
    expect(await preview.text()).toBe("fixture clip");

    const edit = await fetch(`${baseUrl}/jobs/${created.id}/clips/clip-01`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ start: 1_000, end: 31_000, caption: "A custom caption", captionWords: [{ wordIndex: 0, text: "Hi" }], style: "bold", titleOverlay: true, layout: "blurred" }),
    });
    expect(edit.status).toBe(200);
    const saved = await fetch(`${baseUrl}/jobs/${created.id}`);
    const savedBody = await saved.json() as { edits: Record<string, { caption: string; captionWords?: Array<{ wordIndex: number; text: string }>; style: string; titleOverlay: boolean; layout?: string; origStartMs: number; origEndMs: number }> };
    expect(savedBody.edits["clip-01"]!.caption).toBe("A custom caption");
    expect(savedBody.edits["clip-01"]!.style).toBe("bold");
    expect(savedBody.edits["clip-01"]!.titleOverlay).toBe(true);
    expect(savedBody.edits["clip-01"]!.layout).toBe("blurred");
    expect(savedBody.edits["clip-01"]!.origStartMs).toBe(0);
    expect(savedBody.edits["clip-01"]!.origEndMs).toBe(30_000);
    expect(savedBody.edits["clip-01"]!.captionWords).toEqual([{ wordIndex: 0, text: "Hi" }]);

    const invalidWordEdit = await fetch(`${baseUrl}/jobs/${created.id}/clips/clip-01`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ startMs: 1_000, endMs: 31_000, caption: "", captionWords: [{ wordIndex: 5, text: "outside" }] }),
    });
    expect(invalidWordEdit.status).toBe(400);

    const shortTrim = await fetch(`${baseUrl}/jobs/${created.id}/clips/clip-01`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ startMs: 1_000, endMs: 10_000, caption: "A custom caption" }),
    });
    expect(shortTrim.status).toBe(200);
    const trimmed = await fetch(`${baseUrl}/jobs/${created.id}`);
    const trimmedBody = await trimmed.json() as { edits: Record<string, { startMs: number; endMs: number; origStartMs: number; origEndMs: number; captionWords?: Array<{ wordIndex: number; text: string }> }> };
    expect(trimmedBody.edits["clip-01"]).toMatchObject({ startMs: 1_000, endMs: 10_000, origStartMs: 0, origEndMs: 30_000 });
    expect(trimmedBody.edits["clip-01"]!.captionWords).toEqual([{ wordIndex: 0, text: "Hi" }]);

    const rerender = await fetch(`${baseUrl}/jobs/${created.id}/render`, { method: "POST" });
    expect(rerender.status).toBe(202);
    await waitForStatus(baseUrl, created.id, "completed");
    expect(renderCount).toBe(1);
    expect(rerenderFaceTracking).toBe(true);
    expect(rerenderOnlyStale).toBe(true);
    const updated = store.get(created.id)!;
    expect(updated.result?.clips).toHaveLength(1);
  } finally {
    server.stop?.();
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("streaming upload accepts a video larger than Bun's default 128 MiB body limit", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "clipper-large-upload-"));
  const input = path.join(temp, "large.mp4");
  const expectedSize = 129 * 1024 * 1024;
  const writer = Bun.file(input).writer();
  const chunk = new Uint8Array(1024 * 1024);
  for (let index = 0; index < 129; index++) await writer.write(chunk);
  await writer.end();

  const db = new Database(":memory:");
  const store = new JobStore(db);
  const queue = new JobQueue(store, async () => fixtureResult());
  const app = createJobApi(store, queue, { uploadDir: path.join(temp, "uploads"), jobRoot: path.join(temp, "jobs") });
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0, maxRequestBodySize: 2_000_000_000, fetch: app.fetch,
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-video-filename": "large.mp4" },
      body: Bun.file(input),
    });
    expect(response.status).toBe(202);
    const { job } = await response.json() as { job: { id: string; videoPath: string } };
    expect((await Bun.file(job.videoPath).stat()).size).toBe(expectedSize);
    await waitForStatus(`http://127.0.0.1:${server.port}`, job.id, "completed");
  } finally {
    server.stop?.();
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("multipart uploads from an already-open Phase 6 browser still work", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "clipper-multipart-compat-"));
  const db = new Database(":memory:");
  const store = new JobStore(db);
  let pipelineLanguage = "";
  const queue = new JobQueue(store, async (_videoPath, _jobDir, _force, _report, options) => {
    pipelineLanguage = options.language ?? "";
    return fixtureResult();
  });
  const app = createJobApi(store, queue, { uploadDir: path.join(temp, "uploads"), jobRoot: path.join(temp, "jobs") });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 2_000_000_000, fetch: app.fetch });
  try {
    const form = new FormData();
    form.set("video", new File(["legacy browser upload"], "small.mp4", { type: "video/mp4" }));
    form.set("faceTracking", "false");
    form.set("language", "id");
    const response = await fetch(`http://127.0.0.1:${server.port}/jobs`, { method: "POST", body: form });
    expect(response.status).toBe(202);
    const { job } = await response.json() as { job: { id: string; videoPath: string; language: string } };
    expect(job.language).toBe("id");
    expect(await Bun.file(job.videoPath).text()).toBe("legacy browser upload");
    await waitForStatus(`http://127.0.0.1:${server.port}`, job.id, "completed");
    expect(pipelineLanguage).toBe("id");

    form.set("language", "fr");
    const invalidLanguage = await fetch(`http://127.0.0.1:${server.port}/jobs`, { method: "POST", body: form });
    expect(invalidLanguage.status).toBe(400);
  } finally {
    server.stop?.();
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
