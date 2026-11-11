import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { JobQueue } from "./state/queue.ts";
import { JobStore } from "./state/jobs.ts";
import type { ClipCandidate } from "./pipeline/candidates.ts";
import type { ClipRenderEdit } from "./pipeline/render.ts";
import type { Transcript } from "./types.ts";
import { transcriptSentences } from "./pipeline/sentences.ts";

const MAX_UPLOAD_BYTES = 2_000_000_000;

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function mediaResponse(filePath: string, contentType: string, request: Request): Promise<Response> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return json({ error: "Media file not found" }, 404);
  const range = request.headers.get("range");
  const baseHeaders = { "content-type": contentType, "accept-ranges": "bytes", "cache-control": "no-store" };
  if (!range) return new Response(file, { headers: { ...baseHeaders, "content-length": String(file.size) } });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (!match[1] && !match[2])) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${file.size}`, ...baseHeaders } });
  }
  const suffixLength = match[1] ? undefined : Number(match[2]);
  const start = match[1] ? Number(match[1]) : Math.max(0, file.size - (suffixLength ?? 0));
  const end = match[2] && match[1] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
  if (!Number.isSafeInteger(start) || start < 0 || start >= file.size || end < start) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${file.size}`, ...baseHeaders } });
  }
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: { ...baseHeaders, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${file.size}` },
  });
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
        let faceTracking = request.headers.get("x-face-tracking") === "true";
        const contentType = request.headers.get("content-type") ?? "";
        let uploadName: string | undefined;
        let uploadBody: ReadableStream<Uint8Array> | null = null;
        let uploadSize: number | undefined;
        if (contentType.includes("multipart/form-data")) {
          let uploadFile: File | null;
          try {
            const form = await request.formData();
            const entry = form.get("video");
            uploadFile = entry instanceof File ? entry : null;
            faceTracking = form.get("faceTracking") === "true";
          } catch {
            return json({ error: "Upload must be valid multipart form data" }, 400);
          }
          if (!uploadFile) return json({ error: "Multipart upload must include a video file" }, 400);
          uploadName = uploadFile.name;
          uploadBody = uploadFile.stream();
          uploadSize = uploadFile.size;
          if (uploadSize === 0) return json({ error: "Video upload body is empty" }, 400);
        } else if (request.headers.has("x-video-filename")) {
          try {
            uploadName = decodeURIComponent(request.headers.get("x-video-filename") ?? "").trim();
          } catch {
            return json({ error: "x-video-filename must be URL-encoded" }, 400);
          }
          if (!uploadName) return json({ error: "x-video-filename is required" }, 400);
          uploadBody = request.body;
          if (!uploadBody) return json({ error: "Video upload body is empty" }, 400);
          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > MAX_UPLOAD_BYTES) return json({ error: "Video upload must be under 2 GB" }, 413);
        }

        if (uploadName && uploadBody) {
          const extension = path.extname(uploadName).toLowerCase();
          if (![".mp4", ".mov", ".mkv", ".webm", ".m4v"].includes(extension)) {
            return json({ error: "Upload a video file in MP4, MOV, MKV, WEBM, or M4V format" }, 400);
          }
          await mkdir(uploadDir, { recursive: true });
          videoPath = path.resolve(uploadDir, `${randomUUID()}${extension}`);
          let received = 0;
          const output = Bun.file(videoPath).writer();
          try {
            const reader = uploadBody.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              received += value.byteLength;
              if (received > MAX_UPLOAD_BYTES) throw new Error("Video upload exceeds the 2 GB limit");
              await output.write(value);
            }
            await output.end();
            if (uploadSize !== undefined && received !== uploadSize) throw new Error("Multipart video upload was incomplete");
            if (received === 0) throw new Error("Video upload body is empty");
          } catch (error) {
            try {
              await output.end();
            } catch {
              // The output stream may already be closed after a failed write.
            }
            await rm(videoPath, { force: true });
            const message = error instanceof Error ? error.message : String(error);
            return json({ error: message }, message.includes("2 GB") ? 413 : 400);
          }
        } else {
          if (contentType && !contentType.includes("application/json")) {
            return json({ error: "Use a video file upload or send application/json with videoPath" }, 415);
          }
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
          if (payload.faceTracking !== undefined && typeof payload.faceTracking !== "boolean") {
            return json({ error: "faceTracking must be a boolean" }, 400);
          }
          faceTracking = payload.faceTracking === true;
          videoPath = path.resolve(payload.videoPath.trim());
          force = payload.force === true;
          if (!(await Bun.file(videoPath).exists())) {
            return json({ error: `Video not found: ${videoPath}` }, 400);
          }
        }

        const id = randomUUID();
        const job = store.create(id, videoPath, faceTracking);
        queue.enqueue({ id, videoPath, force, faceTracking });
        return json({ job }, 202, { location: `/jobs/${id}` });
      }

      if (url.pathname === "/jobs" && request.method === "GET") {
        const rawLimit = Number(url.searchParams.get("limit") ?? "50");
        const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 50;
        return json({ jobs: store.list(limit).map((job) => ({
          ...job,
          filename: path.basename(job.videoPath),
        })) });
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
        let edits: Record<string, ClipRenderEdit> = {};
        try {
          edits = JSON.parse(await readFile(path.join(jobRoot, job.id, "edits.json"), "utf8")) as Record<string, ClipRenderEdit>;
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
        return json({ job, edits });
      }

      const transcriptMatch = url.pathname.match(/^\/jobs\/([^/]+)\/transcript$/);
      if (transcriptMatch && request.method === "GET") {
        const job = store.get(decodeURIComponent(transcriptMatch[1]!));
        if (!job) return json({ error: "Job not found" }, 404);
        const transcript = JSON.parse(await readFile(path.join(jobRoot, job.id, "transcript.json"), "utf8")) as Transcript;
        const sentences = transcriptSentences(transcript).map((sentence) => ({
          ...sentence,
          words: transcript.words.flatMap((word, wordIndex) => word.start < sentence.end && word.end > sentence.start
            ? [{ ...word, wordIndex }]
            : []),
        }));
        return json({ sentences });
      }

      const sourceMatch = url.pathname.match(/^\/jobs\/([^/]+)\/source$/);
      if (sourceMatch && request.method === "GET") {
        const job = store.get(decodeURIComponent(sourceMatch[1]!));
        if (!job) return json({ error: "Job not found" }, 404);
        const extension = path.extname(job.videoPath).toLowerCase();
        const contentType = extension === ".webm" ? "video/webm" : extension === ".mov" ? "video/quicktime" : "video/mp4";
        return mediaResponse(job.videoPath, contentType, request);
      }

      const clipsCollection = url.pathname.match(/^\/jobs\/([^/]+)\/clips$/);
      if (clipsCollection && request.method === "POST") {
        const jobId = decodeURIComponent(clipsCollection[1]!);
        const job = store.get(jobId);
        if (!job?.result || job.status !== "completed") return json({ error: "Completed job not found" }, 404);
        let payload: unknown;
        try { payload = await request.json(); } catch { return json({ error: "Request body must be valid JSON" }, 400); }
        if (!isRecord(payload) || typeof payload.startMs !== "number" || typeof payload.endMs !== "number") {
          return json({ error: "startMs and endMs are required" }, 400);
        }
        const startMs = payload.startMs as number;
        const endMs = payload.endMs as number;
        const transcript = JSON.parse(await readFile(path.join(jobRoot, jobId, "transcript.json"), "utf8")) as Transcript;
        const sentences = transcriptSentences(transcript);
        const startSentence = sentences.find((sentence) => sentence.start <= startMs && sentence.end > startMs);
        const endSentence = [...sentences].reverse().find((sentence) => sentence.start < endMs && sentence.end >= endMs);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !startSentence || !endSentence || endSentence.id < startSentence.id) {
          return json({ error: "Selection must fall within the transcript" }, 400);
        }
        const start = startSentence.start;
        const end = endSentence.end;
        if (end - start < 30_000 || end - start > 90_000) return json({ error: "Clip must be between 30 and 90 seconds" }, 400);
        const candidates = JSON.parse(await readFile(path.join(jobRoot, jobId, "candidates.json"), "utf8")) as ClipCandidate[];
        const existingIds = candidates.map((candidate, index) => candidate.id ?? `clip-${String(index + 1).padStart(2, "0")}`);
        const maxId = existingIds.reduce((max, id) => Math.max(max, Number(id.match(/^clip-(\d+)$/)?.[1] ?? 0)), 0);
        const id = `clip-${String(maxId + 1).padStart(2, "0")}`;
        const candidate: ClipCandidate = {
          id, startSentenceId: startSentence.id, endSentenceId: endSentence.id,
          start, end, hook: "", title: "New clip", score: 0, reason: "Created from transcript selection",
        };
        await writeFile(path.join(jobRoot, jobId, "candidates.json"), JSON.stringify([...candidates, candidate], null, 2));
        const manifestClip = {
          id, file: `clips/${id}.mp4`, captions: `captions/${id}.ass`, start, end, duration: end - start,
          startSentenceId: candidate.startSentenceId, endSentenceId: candidate.endSentenceId,
          title: candidate.title, hook: candidate.hook, score: candidate.score, reason: candidate.reason,
        };
        const manifest = { ...job.result, clips: [...job.result.clips, manifestClip] };
        store.updateResult(jobId, manifest);
        return json({ clip: manifestClip }, 201);
      }

      const sourceClipMatch = url.pathname.match(/^\/jobs\/([^/]+)\/clips\/(clip-\d{2})(?:\/file)?$/);
      if (sourceClipMatch && request.method === "GET") {
        const job = store.get(decodeURIComponent(sourceClipMatch[1]!));
        if (!job?.result || job.status !== "completed") return json({ error: "Clip not found" }, 404);
        const clip = job.result.clips.find((item) => item.id === sourceClipMatch[2]);
        if (!clip) return json({ error: "Clip not found" }, 404);
        const file = Bun.file(path.join(jobRoot, job.id, clip.file));
        if (!(await file.exists())) return json({ error: "Rendered clip file not found" }, 404);
        return mediaResponse(path.join(jobRoot, job.id, clip.file), "video/mp4", request);
      }

      const deleteClipMatch = url.pathname.match(/^\/jobs\/([^/]+)\/clips\/(clip-\d{2})$/);
      if (deleteClipMatch && request.method === "DELETE") {
        const jobId = decodeURIComponent(deleteClipMatch[1]!);
        const job = store.get(jobId);
        if (!job?.result || job.status !== "completed") return json({ error: "Completed job not found" }, 404);
        const clipId = deleteClipMatch[2]!;
        if (!job.result.clips.some((clip) => clip.id === clipId)) return json({ error: "Clip not found" }, 404);
        const jobDir = path.join(jobRoot, jobId);
        const candidates = JSON.parse(await readFile(path.join(jobDir, "candidates.json"), "utf8")) as ClipCandidate[];
        const retained = candidates.filter((candidate, index) => (candidate.id ?? `clip-${String(index + 1).padStart(2, "0")}`) !== clipId);
        await writeFile(path.join(jobDir, "candidates.json"), JSON.stringify(retained, null, 2));
        let edits: Record<string, ClipRenderEdit> = {};
        try { edits = JSON.parse(await readFile(path.join(jobDir, "edits.json"), "utf8")) as Record<string, ClipRenderEdit>; }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
        delete edits[clipId];
        await writeFile(path.join(jobDir, "edits.json"), JSON.stringify(edits, null, 2));
        for (const relative of [`clips/${clipId}.mp4`, `captions/${clipId}.ass`]) {
          await rm(path.join(jobDir, relative), { force: true });
        }
        const manifest = { ...job.result, clips: job.result.clips.filter((clip) => clip.id !== clipId) };
        store.updateResult(jobId, manifest);
        return json({ ok: true, clips: manifest.clips });
      }

      const renderClipMatch = url.pathname.match(/^\/jobs\/([^/]+)\/clips\/(clip-\d{2})\/render$/);
      if (renderClipMatch && request.method === "POST") {
        const jobId = decodeURIComponent(renderClipMatch[1]!);
        const job = store.get(jobId);
        if (!job?.result || job.status !== "completed") return json({ error: "Completed job not found" }, 404);
        if (!job.result.clips.some((clip) => clip.id === renderClipMatch[2])) return json({ error: "Clip not found" }, 404);
        store.requeue(jobId);
        queue.enqueue({ id: jobId, videoPath: job.videoPath, force: true, operation: "render", faceTracking: job.faceTracking, clipId: renderClipMatch[2] });
        return json({ job: store.get(jobId) }, 202);
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
        if (!isRecord(payload) || typeof (payload.startMs ?? payload.start) !== "number" || typeof (payload.endMs ?? payload.end) !== "number" || typeof payload.caption !== "string") {
          return json({ error: "startMs, endMs, and caption are required" }, 400);
        }
        if (payload.style !== undefined && !["classic", "bold", "clean"].includes(String(payload.style))) {
          return json({ error: "style must be classic, bold, or clean" }, 400);
        }
        if (payload.titleOverlay !== undefined && typeof payload.titleOverlay !== "boolean") {
          return json({ error: "titleOverlay must be a boolean" }, 400);
        }
        if (payload.layout !== undefined && !["crop", "blurred", "stacked"].includes(String(payload.layout))) {
          return json({ error: "layout must be crop, blurred, or stacked" }, 400);
        }
        const clipIndex = job.result.clips.findIndex((item) => item.id === editMatch[2]);
        if (clipIndex < 0) return json({ error: "Clip not found" }, 404);
        const oldClip = job.result.clips[clipIndex]!;
        const start = (payload.startMs ?? payload.start) as number;
        const end = (payload.endMs ?? payload.end) as number;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
          return json({ error: "Trim must have a non-negative start before its end" }, 400);
        }
        if (payload.caption.length > 2_000) return json({ error: "Caption text must be at most 2000 characters" }, 400);
        const jobDir = path.join(jobRoot, jobId);
        const transcript = JSON.parse(await readFile(path.join(jobDir, "transcript.json"), "utf8")) as Transcript;
        if (end > (transcript.words.at(-1)?.end ?? 0)) return json({ error: "Trim end exceeds the transcript duration" }, 400);
        if (payload.captionWords !== undefined) {
          if (!Array.isArray(payload.captionWords)) return json({ error: "captionWords must be an array" }, 400);
          const seen = new Set<number>();
          for (const item of payload.captionWords) {
            if (!isRecord(item) || !Number.isInteger(item.wordIndex) || typeof item.text !== "string") {
              return json({ error: "Each caption word needs an integer wordIndex and text" }, 400);
            }
            const wordIndex = item.wordIndex as number;
            if (wordIndex < 0 || wordIndex >= transcript.words.length || seen.has(wordIndex) || item.text.length > 500) {
              return json({ error: "captionWords contains an invalid index, duplicate, or oversized edit" }, 400);
            }
            seen.add(wordIndex);
          }
        }
        const candidates = JSON.parse(await readFile(path.join(jobDir, "candidates.json"), "utf8")) as ClipCandidate[];
        const candidate = candidates[clipIndex];
        if (!candidate) return json({ error: "Candidate data is missing for this clip" }, 409);
        candidates[clipIndex] = { ...candidate, start, end };
        await writeFile(path.join(jobDir, "candidates.json"), JSON.stringify(candidates, null, 2));
        let edits: Record<string, ClipRenderEdit> = {};
        try {
          edits = JSON.parse(await readFile(path.join(jobDir, "edits.json"), "utf8")) as Record<string, ClipRenderEdit>;
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
        const previous = edits[oldClip.id] ?? {};
        edits[oldClip.id] = {
          startMs: start,
          endMs: end,
          caption: payload.caption.trim(),
          captionWords: (payload.captionWords as ClipRenderEdit["captionWords"] | undefined) ?? previous.captionWords ?? [],
          style: (payload.style as ClipRenderEdit["style"] | undefined) ?? previous.style ?? "classic",
          titleOverlay: (payload.titleOverlay as boolean | undefined) ?? previous.titleOverlay ?? false,
          layout: (payload.layout as ClipRenderEdit["layout"] | undefined) ?? previous.layout ?? "crop",
          origStartMs: previous.origStartMs ?? oldClip.start,
          origEndMs: previous.origEndMs ?? oldClip.end,
        };
        await writeFile(path.join(jobDir, "edits.json"), JSON.stringify(edits, null, 2));
        return json({ ok: true, edits });
      }

      const renderMatch = url.pathname.match(/^\/jobs\/([^/]+)\/render$/);
      if (renderMatch && request.method === "POST") {
        const jobId = decodeURIComponent(renderMatch[1]!);
        const job = store.get(jobId);
        if (!job?.result || job.status !== "completed") return json({ error: "Completed job not found" }, 404);
        store.requeue(jobId);
        queue.enqueue({ id: jobId, videoPath: job.videoPath, force: true, operation: "render", faceTracking: job.faceTracking });
        return json({ job: store.get(jobId) }, 202);
      }

      return json({ error: "Not found" }, 404);
    },
  };
}
