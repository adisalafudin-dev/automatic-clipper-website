import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { JobQueue } from "./state/queue.ts";
import { JobStore } from "./state/jobs.ts";
import type { ClipCandidate } from "./pipeline/candidates.ts";
import type { Transcript } from "./types.ts";

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createJobApi(
  store: JobStore,
  queue: JobQueue,
  options: { uploadDir?: string; jobRoot?: string } = {},
) {
  const uploadDir = options.uploadDir ?? path.join("data", "uploads");
  const jobRoot = options.jobRoot ?? path.join("data", "jobs");
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ status: "ok" });
      }

      if (url.pathname === "/jobs" && request.method === "POST") {
        let videoPath: string;
        let force = false;
        if (request.headers.get("content-type")?.includes("multipart/form-data")) {
          let file: File | null;
          try {
            const form = await request.formData();
            const entry = form.get("video");
            file = entry instanceof File ? entry : null;
          } catch {
            return json({ error: "Upload must be valid multipart form data" }, 400);
          }
          if (!file || file.size === 0 || file.size > 2_000_000_000) {
            return json({ error: "video must be a non-empty file under 2 GB" }, 400);
          }
          const extension = path.extname(file.name).toLowerCase();
          if (![".mp4", ".mov", ".mkv", ".webm", ".m4v"].includes(extension)) {
            return json({ error: "Upload a video file in MP4, MOV, MKV, WEBM, or M4V format" }, 400);
          }
          await mkdir(uploadDir, { recursive: true });
          videoPath = path.resolve(uploadDir, `${randomUUID()}${extension}`);
          await Bun.write(videoPath, file);
        } else {
          let payload: unknown;
          try {
            payload = await request.json();
          } catch {
            return json({ error: "Request body must be valid JSON" }, 400);
          }
          if (!isRecord(payload) || typeof payload.videoPath !== "string" || !payload.videoPath.trim()) {
            return json({ error: "videoPath must be a non-empty string" }, 400);
          }
          if (payload.force !== undefined && typeof payload.force !== "boolean") {
            return json({ error: "force must be a boolean" }, 400);
          }
          videoPath = path.resolve(payload.videoPath.trim());
          force = payload.force === true;
          if (!(await Bun.file(videoPath).exists())) {
            return json({ error: `Video not found: ${videoPath}` }, 400);
          }
        }

        const id = randomUUID();
        const job = store.create(id, videoPath);
        queue.enqueue({ id, videoPath, force });
        return json({ job }, 202, { location: `/jobs/${id}` });
      }

      if (url.pathname === "/jobs" && request.method === "GET") {
        const rawLimit = Number(url.searchParams.get("limit") ?? "50");
        const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 50;
        return json({ jobs: store.list(limit) });
      }

      const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/);
      if (jobMatch && request.method === "GET") {
        let id: string;
        try {
          id = decodeURIComponent(jobMatch[1]!);
        } catch {
          return json({ error: "Invalid job ID" }, 400);
        }
        const job = store.get(id);
        if (!job) return json({ error: "Job not found" }, 404);
        let edits: Record<string, string> = {};
        try {
          edits = JSON.parse(await readFile(path.join("data", "jobs", job.id, "edits.json"), "utf8")) as Record<string, string>;
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
        return json({ job, edits });
      }

      const clipMatch = url.pathname.match(/^\/jobs\/([^/]+)\/clips\/(clip-\d{2})$/);
      if (clipMatch && request.method === "GET") {
        const job = store.get(decodeURIComponent(clipMatch[1]!));
        if (!job?.result || job.status !== "completed") return json({ error: "Clip not found" }, 404);
        const clip = job.result.clips.find((item) => item.id === clipMatch[2]);
        if (!clip) return json({ error: "Clip not found" }, 404);
        const file = Bun.file(path.join("data", "jobs", job.id, clip.file));
        if (!(await file.exists())) return json({ error: "Rendered clip file not found" }, 404);
        return new Response(file, { headers: { "content-type": "video/mp4", "cache-control": "no-store" } });
      }

      const editMatch = url.pathname.match(/^\/jobs\/([^/]+)\/clips\/(clip-\d{2})$/);
      if (editMatch && request.method === "PATCH") {
        const jobId = decodeURIComponent(editMatch[1]!);
        const job = store.get(jobId);
        if (!job?.result || job.status !== "completed") return json({ error: "Completed job not found" }, 404);
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return json({ error: "Request body must be valid JSON" }, 400);
        }
        if (!isRecord(payload) || typeof payload.start !== "number" || typeof payload.end !== "number" || typeof payload.caption !== "string") {
          return json({ error: "start, end, and caption are required" }, 400);
        }
        const clipIndex = job.result.clips.findIndex((item) => item.id === editMatch[2]);
        if (clipIndex < 0) return json({ error: "Clip not found" }, 404);
        const oldClip = job.result.clips[clipIndex]!;
        const start = payload.start;
        const end = payload.end;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 30_000 || end - start > 90_000) {
          return json({ error: "Trim must be between 30 and 90 seconds with a non-negative start" }, 400);
        }
        if (payload.caption.length > 2_000) return json({ error: "Caption text must be at most 2000 characters" }, 400);
        const jobDir = path.join("data", "jobs", jobId);
        const transcript = JSON.parse(await readFile(path.join(jobDir, "transcript.json"), "utf8")) as Transcript;
        if (end > (transcript.words.at(-1)?.end ?? 0)) return json({ error: "Trim end exceeds the transcript duration" }, 400);
        const candidates = JSON.parse(await readFile(path.join(jobDir, "candidates.json"), "utf8")) as ClipCandidate[];
        const candidate = candidates[clipIndex];
        if (!candidate) return json({ error: "Candidate data is missing for this clip" }, 409);
        candidates[clipIndex] = { ...candidate, start, end };
        await writeFile(path.join(jobDir, "candidates.json"), JSON.stringify(candidates, null, 2));
        let edits: Record<string, string> = {};
        try {
          edits = JSON.parse(await readFile(path.join(jobDir, "edits.json"), "utf8")) as Record<string, string>;
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
        if (payload.caption.trim()) edits[oldClip.id] = payload.caption.trim();
        else delete edits[oldClip.id];
        await writeFile(path.join(jobDir, "edits.json"), JSON.stringify(edits, null, 2));
        return json({ ok: true, edits });
      }

      const renderMatch = url.pathname.match(/^\/jobs\/([^/]+)\/render$/);
      if (renderMatch && request.method === "POST") {
        const jobId = decodeURIComponent(renderMatch[1]!);
        const job = store.get(jobId);
        if (!job?.result || job.status !== "completed") return json({ error: "Completed job not found" }, 404);
        store.requeue(jobId);
        queue.enqueue({ id: jobId, videoPath: job.videoPath, force: true, operation: "render" });
        return json({ job: store.get(jobId) }, 202);
      }

      return json({ error: "Not found" }, 404);
    },
  };
}
