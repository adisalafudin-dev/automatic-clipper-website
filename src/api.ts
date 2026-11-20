import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { JobQueue } from "./state/queue.ts";
import { JobStore } from "./state/jobs.ts";
import type { ClipCandidate } from "./pipeline/candidates.ts";
import type { ClipRenderEdit } from "./pipeline/render.ts";
import type { ClipFeedback, ClipFeedbackDecision, ClipFeedbackReason, ClipLanguage, Transcript } from "./types.ts";
import { transcriptSentences } from "./pipeline/sentences.ts";
import { isClipLanguage } from "./languages.ts";
import { getMode, listModes, parseFacecamRect, type FacecamRect, type ModeName } from "./modes.ts";
import { defaultProjectName, normalizeProjectName } from "./project-name.ts";
import { LlmSettingsStore, type LlmSettingsInput } from "./llm-settings.ts";

const MAX_UPLOAD_BYTES = 2_000_000_000;
const CLIP_FEEDBACK_REASONS = new Set<ClipFeedbackReason>([
  "weak_hook", "missing_context", "weak_payoff", "transcript_error",
]);

async function readClipFeedback(jobDir: string): Promise<Record<string, ClipFeedback>> {
  try {
    return JSON.parse(await readFile(path.join(jobDir, "feedback.json"), "utf8")) as Record<string, ClipFeedback>;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

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
  options: { uploadDir?: string; jobRoot?: string; llmSettings?: LlmSettingsStore } = {},
) {
  const uploadDir = options.uploadDir ?? path.join("data", "uploads");
  const jobRoot = options.jobRoot ?? path.join("data", "jobs");
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ status: "ok" });
      }

      if (url.pathname === "/modes" && request.method === "GET") {
        return json(listModes());
      }

      if (url.pathname === "/settings/llm" && request.method === "GET") {
        return json(options.llmSettings?.publicSettings() ?? { baseUrl: process.env.LLM_BASE_URL ?? "http://192.168.1.9:20128/v1", model: process.env.LLM_MODEL ?? "hermes-main", configured: Boolean(process.env.LLM_API_KEY) });
      }

      if (url.pathname === "/settings/llm" && request.method === "PUT") {
        if (!options.llmSettings) return json({ error: "LLM settings are unavailable" }, 503);
        try {
          const body = await request.json() as LlmSettingsInput;
          return json({ settings: await options.llmSettings.update(body) });
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
      }

      if (url.pathname === "/settings/llm/test" && request.method === "POST") {
        if (!options.llmSettings) return json({ error: "LLM settings are unavailable" }, 503);
        try {
          await options.llmSettings.testConnection();
          return json({ ok: true });
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 502);
        }
      }

      const retryMatch = url.pathname.match(/^\/jobs\/([^/]+)\/retry$/);
      if (retryMatch && request.method === "POST") {
        let jobId: string;
        try { jobId = decodeURIComponent(retryMatch[1]!); }
        catch { return json({ error: "Invalid job ID" }, 400); }
        const job = store.get(jobId);
        if (!job) return json({ error: "Job not found" }, 404);
        if (job.status === "queued" || job.status === "running") return json({ error: "Job is already processing" }, 409);
        if (!(await Bun.file(job.videoPath).exists())) return json({ error: "Original video file not found" }, 404);
        const hasRenderedClips = (job.result?.clips.length ?? 0) > 0;
        store.requeue(jobId);
        queue.enqueue({
          id: job.id, videoPath: job.videoPath, force: false,
          ...(hasRenderedClips ? { operation: "render" as const, onlyStale: true } : { reselect: true }),
          faceTracking: job.faceTracking, captionsEnabled: job.captionsEnabled, language: job.language, mode: job.mode, facecamRect: job.facecamRect,
        });
        return json({ job: store.get(jobId) }, 202);
      }

      if (url.pathname === "/jobs" && request.method === "POST") {
        let videoPath: string;
        let force = false;
        let faceTracking = request.headers.get("x-face-tracking") === "true";
        let captionsEnabled = request.headers.get("x-captions-enabled") !== "false";
        let languageInput: unknown = "auto";
        let modeInput: unknown;
        let facecamRectInput: unknown;
        let displayNameInput: unknown;
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
            captionsEnabled = form.get("captionsEnabled") !== "false";
            languageInput = form.get("language") ?? languageInput;
            modeInput = form.get("mode") ?? undefined;
            facecamRectInput = form.get("facecamRect") ?? undefined;
            displayNameInput = form.get("displayName") ?? undefined;
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
          languageInput = request.headers.get("x-language") ?? languageInput;
          modeInput = request.headers.get("x-mode") ?? undefined;
          facecamRectInput = request.headers.get("x-facecam-rect") ?? undefined;
          faceTracking = request.headers.get("x-face-tracking") === "true";
          captionsEnabled = request.headers.get("x-captions-enabled") !== "false";
          const projectNameHeader = request.headers.get("x-project-name");
          if (projectNameHeader) {
            try {
              displayNameInput = decodeURIComponent(projectNameHeader);
            } catch {
              return json({ error: "x-project-name must be URL-encoded" }, 400);
            }
          }
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
          if (payload.captionsEnabled !== undefined && typeof payload.captionsEnabled !== "boolean") return json({ error: "captionsEnabled must be a boolean" }, 400);
          languageInput = payload.language ?? languageInput;
          if (Object.hasOwn(payload, "mode")) modeInput = payload.mode;
          if (Object.hasOwn(payload, "facecamRect")) facecamRectInput = payload.facecamRect;
          if (Object.hasOwn(payload, "displayName")) displayNameInput = payload.displayName;
          faceTracking = payload.faceTracking === true;
          captionsEnabled = payload.captionsEnabled !== false;
          videoPath = path.resolve(payload.videoPath.trim());
          force = payload.force === true;
          if (!(await Bun.file(videoPath).exists())) {
            return json({ error: `Video not found: ${videoPath}` }, 400);
          }
        }

        if (!isClipLanguage(languageInput)) {
          return json({ error: "language must be 'en' or 'id'" }, 400);
        }
        const language: ClipLanguage = languageInput;
        if (modeInput !== undefined && typeof modeInput !== "string") {
          return json({ error: "mode must be a string" }, 400);
        }
        let mode: ModeName;
        try {
          mode = getMode(modeInput).name as ModeName;
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
        let facecamRect: FacecamRect | null = null;
        if (facecamRectInput !== undefined && facecamRectInput !== null && facecamRectInput !== "") {
          if (typeof facecamRectInput !== "string") return json({ error: "facecamRect must be x,y,w,h using normalized values" }, 400);
          try { facecamRect = parseFacecamRect(facecamRectInput); }
          catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
        }

        let displayName: string;
        try {
          displayName = displayNameInput === undefined || displayNameInput === null || displayNameInput === ""
            ? defaultProjectName(uploadName ?? videoPath)
            : normalizeProjectName(displayNameInput);
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }

        const id = randomUUID();
        const job = store.create(id, videoPath, faceTracking, language, mode, facecamRect, displayName, captionsEnabled);
        queue.enqueue({ id, videoPath, force, faceTracking, captionsEnabled, language, mode, facecamRect });
        return json({ job: { ...job, filename: job.displayName } }, 202, { location: `/jobs/${id}` });
      }

      if (url.pathname === "/jobs" && request.method === "GET") {
        const rawLimit = Number(url.searchParams.get("limit") ?? "50");
        const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 50;
        return json({ jobs: store.list(limit).map((job) => ({
          ...job,
          filename: job.displayName,
        })) });
      }

      const cancelMatch = url.pathname.match(/^\/jobs\/([^/]+)\/cancel$/);
      if (cancelMatch && request.method === "POST") {
        let jobId: string;
        try { jobId = decodeURIComponent(cancelMatch[1]!); }
        catch { return json({ error: "Invalid job ID" }, 400); }
        const job = store.get(jobId);
        if (!job) return json({ error: "Job not found" }, 404);
        if (job.status !== "queued" && job.status !== "running") return json({ error: `Cannot cancel a ${job.status} job` }, 409);
        if (!(await queue.cancel(jobId))) return json({ error: "Job is no longer queued or running" }, 409);
        store.cancel(jobId);
        return json({ job: store.get(jobId) });
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
        const feedback = await readClipFeedback(path.join(jobRoot, job.id));
        return json({ job: { ...job, filename: job.displayName }, edits, feedback });
      }

      if (jobMatch && request.method === "DELETE") {
        let id: string;
        try { id = decodeURIComponent(jobMatch[1]!); }
        catch { return json({ error: "Invalid job ID" }, 400); }
        let job = store.get(id);
        if (!job) return json({ error: "Project not found" }, 404);
        if (job.status === "queued" || job.status === "running") {
          await queue.cancel(id);
          job = store.get(id);
          if (!job) return json({ error: "Project not found" }, 404);
        }
        const resolvedJobRoot = path.resolve(jobRoot);
        const resolvedJobDir = path.resolve(resolvedJobRoot, job.id);
        const jobRelative = path.relative(resolvedJobRoot, resolvedJobDir);
        if (!jobRelative || jobRelative === ".." || jobRelative.startsWith(`..${path.sep}`) || path.isAbsolute(jobRelative)) {
          return json({ error: "Project data path is invalid" }, 500);
        }
        try {
          await rm(resolvedJobDir, { recursive: true, force: true });
          const resolvedUploads = path.resolve(uploadDir);
          const resolvedSource = path.resolve(job.videoPath);
          const uploadRelative = path.relative(resolvedUploads, resolvedSource);
          const isUploadedSource = uploadRelative !== "" && !uploadRelative.startsWith(`..${path.sep}`) && uploadRelative !== ".." && !path.isAbsolute(uploadRelative);
          if (isUploadedSource) await rm(resolvedSource, { force: true });
          if (!store.remove(id)) return json({ error: "Project was already deleted" }, 404);
        } catch (error) {
          return json({ error: `Could not delete project files: ${error instanceof Error ? error.message : String(error)}` }, 500);
        }
        return json({ ok: true });
      }

      const clipFeedbackMatch = url.pathname.match(/^\/jobs\/([^/]+)\/clips\/(clip-\d{2})\/feedback$/);
      if (clipFeedbackMatch && request.method === "PUT") {
        let jobId: string;
        try { jobId = decodeURIComponent(clipFeedbackMatch[1]!); }
        catch { return json({ error: "Invalid job ID" }, 400); }
        const job = store.get(jobId);
        if (!job?.result) return json({ error: "Completed job not found" }, 404);
        const clipId = clipFeedbackMatch[2]!;
        if (!job.result.clips.some((clip) => clip.id === clipId)) return json({ error: "Clip not found" }, 404);
        let payload: unknown;
        try { payload = await request.json(); }
        catch { return json({ error: "Request body must be valid JSON" }, 400); }
        if (!isRecord(payload) || Object.keys(payload).some((key) => key !== "decision" && key !== "reason")) {
          return json({ error: "Feedback must include a decision and an optional reason" }, 400);
        }
        const decision = payload.decision;
        const reason = payload.reason;
        if (decision !== "post" && decision !== "skip") return json({ error: "Decision must be post or skip" }, 400);
        if (reason !== undefined && reason !== "" && (typeof reason !== "string" || !CLIP_FEEDBACK_REASONS.has(reason as ClipFeedbackReason))) {
          return json({ error: "Reason must be weak_hook, missing_context, weak_payoff, or transcript_error" }, 400);
        }
        if (decision === "post" && reason) return json({ error: "Reasons apply to skipped clips only" }, 400);
        const feedback = await readClipFeedback(path.join(jobRoot, jobId));
        const entry: ClipFeedback = {
          decision: decision as ClipFeedbackDecision,
          ...(decision === "skip" && reason ? { reason: reason as ClipFeedbackReason } : {}),
          updatedAt: new Date().toISOString(),
        };
        feedback[clipId] = entry;
        await writeFile(path.join(jobRoot, jobId, "feedback.json"), JSON.stringify(feedback, null, 2));
        return json({ feedback });
      }

      const transcriptMatch = url.pathname.match(/^\/jobs\/([^/]+)\/transcript$/);
      if (transcriptMatch && request.method === "GET") {
        const job = store.get(decodeURIComponent(transcriptMatch[1]!));
        if (!job) return json({ error: "Job not found" }, 404);
        let transcript: Transcript;
        try {
          transcript = JSON.parse(await readFile(path.join(jobRoot, job.id, "transcript.json"), "utf8")) as Transcript;
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return json({ sentences: [] });
          }
          throw error;
        }
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
        if (!job?.result) return json({ error: "Completed job not found" }, 404);
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
        const storedCandidates = JSON.parse(await readFile(path.join(jobRoot, jobId, "candidates.json"), "utf8")) as ClipCandidate[];
        const candidates = storedCandidates.map((candidate, index) => ({
          ...candidate,
          id: candidate.id ?? job.result!.clips[index]?.id ?? `clip-${String(index + 1).padStart(2, "0")}`,
        }));
        const existingIds = candidates.map((candidate) => candidate.id!);
        const maxId = existingIds.reduce((max, id) => Math.max(max, Number(id.match(/^clip-(\d+)$/)?.[1] ?? 0)), 0);
        const id = `clip-${String(maxId + 1).padStart(2, "0")}`;
        const selectedSentences = sentences.filter((sentence) => sentence.id >= startSentence.id && sentence.id <= endSentence.id);
        const hook = selectedSentences.map((sentence) => sentence.text).join(" ").slice(0, 240);
        const candidate: ClipCandidate = {
          id, startSentenceId: startSentence.id, endSentenceId: endSentence.id,
          start, end, hook, title: `Selection ${maxId + 1}`, score: 0, reason: "Created from transcript selection",
        };
        await writeFile(path.join(jobRoot, jobId, "candidates.json"), JSON.stringify([...candidates, candidate], null, 2));
        const manifestClip = {
          id, file: `clips/${id}.mp4`, captions: `captions/${id}.ass`, start, end, duration: end - start,
          startSentenceId: candidate.startSentenceId, endSentenceId: candidate.endSentenceId,
          title: candidate.title, hook: candidate.hook, score: candidate.score, reason: candidate.reason,
        };
        const manifest = { ...job.result, clips: [...job.result.clips, manifestClip] };
        store.updateResult(jobId, manifest);
        let edits: Record<string, ClipRenderEdit> = {};
        try { edits = JSON.parse(await readFile(path.join(jobRoot, jobId, "edits.json"), "utf8")) as Record<string, ClipRenderEdit>; }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
        edits[id] = { startMs: start, endMs: end, origStartMs: start, origEndMs: end, renderStatus: "none" };
        await writeFile(path.join(jobRoot, jobId, "edits.json"), JSON.stringify(edits, null, 2));
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
        if (!job?.result) return json({ error: "Completed job not found" }, 404);
        const clipId = deleteClipMatch[2]!;
        if (!job.result.clips.some((clip) => clip.id === clipId)) return json({ error: "Clip not found" }, 404);
        const jobDir = path.join(jobRoot, jobId);
        const storedCandidates = JSON.parse(await readFile(path.join(jobDir, "candidates.json"), "utf8")) as ClipCandidate[];
        const candidates = storedCandidates.map((candidate, index) => ({
          ...candidate,
          id: candidate.id ?? job.result!.clips[index]?.id ?? `clip-${String(index + 1).padStart(2, "0")}`,
        }));
        const retained = candidates.filter((candidate) => candidate.id !== clipId);
        await writeFile(path.join(jobDir, "candidates.json"), JSON.stringify(retained, null, 2));
        let edits: Record<string, ClipRenderEdit> = {};
        try { edits = JSON.parse(await readFile(path.join(jobDir, "edits.json"), "utf8")) as Record<string, ClipRenderEdit>; }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
        delete edits[clipId];
        await writeFile(path.join(jobDir, "edits.json"), JSON.stringify(edits, null, 2));
        const feedback = await readClipFeedback(jobDir);
        if (feedback[clipId]) {
          delete feedback[clipId];
          await writeFile(path.join(jobDir, "feedback.json"), JSON.stringify(feedback, null, 2));
        }
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
        if (!job?.result) return json({ error: "Completed job not found" }, 404);
        if (job.status === "queued" || job.status === "running") return json({ error: "Job is already processing" }, 409);
        if (!job.result.clips.some((clip) => clip.id === renderClipMatch[2])) return json({ error: "Clip not found" }, 404);
        let mode = job.mode;
        let faceTracking = job.faceTracking;
        let captionsEnabled = job.captionsEnabled;
        let facecamRect = job.facecamRect;
        if (request.headers.get("content-type")?.includes("application/json")) {
          let payload: unknown;
          try { payload = await request.json(); }
          catch { return json({ error: "Render settings must be valid JSON" }, 400); }
          if (!isRecord(payload)) return json({ error: "Render settings must be a JSON object" }, 400);
          try {
            if (payload.mode !== undefined) {
              if (typeof payload.mode !== "string") return json({ error: "mode must be a valid mode name" }, 400);
              mode = getMode(payload.mode).name as ModeName;
            }
            if (payload.faceTracking !== undefined) {
              if (typeof payload.faceTracking !== "boolean") return json({ error: "faceTracking must be a boolean" }, 400);
              faceTracking = payload.faceTracking;
            }
            if (payload.captionsEnabled !== undefined) {
              if (typeof payload.captionsEnabled !== "boolean") return json({ error: "captionsEnabled must be a boolean" }, 400);
              captionsEnabled = payload.captionsEnabled;
            }
            if (Object.hasOwn(payload, "facecamRect")) {
              if (payload.facecamRect === null) facecamRect = null;
              else if (typeof payload.facecamRect === "string") facecamRect = parseFacecamRect(payload.facecamRect);
              else return json({ error: "facecamRect must be normalized x,y,w,h or null for automatic detection" }, 400);
            }
          } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
          store.updateRenderSettings(jobId, { mode, faceTracking, captionsEnabled, facecamRect });
        }
        const jobDir = path.join(jobRoot, jobId);
        let edits: Record<string, ClipRenderEdit> = {};
        try { edits = JSON.parse(await readFile(path.join(jobDir, "edits.json"), "utf8")) as Record<string, ClipRenderEdit>; }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
        const clipId = renderClipMatch[2]!;
        edits[clipId] = { ...edits[clipId], renderStatus: "queued", renderError: undefined };
        await writeFile(path.join(jobDir, "edits.json"), JSON.stringify(edits, null, 2));
        store.requeue(jobId);
        queue.enqueue({ id: jobId, videoPath: job.videoPath, force: true, operation: "render", faceTracking, captionsEnabled, clipId, mode, facecamRect });
        return json({ job: store.get(jobId) }, 202);
      }

      const editMatch = url.pathname.match(/^\/jobs\/([^/]+)\/clips\/(clip-\d{2})$/);
      if (editMatch && request.method === "PATCH") {
        const jobId = decodeURIComponent(editMatch[1]!);
        const job = store.get(jobId);
        if (!job?.result) return json({ error: "Completed job not found" }, 404);
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
        const storedCandidates = JSON.parse(await readFile(path.join(jobDir, "candidates.json"), "utf8")) as ClipCandidate[];
        const candidates = storedCandidates.map((candidate, index) => ({
          ...candidate,
          id: candidate.id ?? job.result!.clips[index]?.id ?? `clip-${String(index + 1).padStart(2, "0")}`,
        }));
        const candidateIndex = candidates.findIndex((candidate) => candidate.id === oldClip.id);
        const candidate = candidates[candidateIndex];
        if (!candidate) return json({ error: "Candidate data is missing for this clip" }, 409);
        candidates[candidateIndex] = { ...candidate, start, end };
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
          layout: (payload.layout as ClipRenderEdit["layout"] | undefined) ?? previous.layout,
          origStartMs: previous.origStartMs ?? oldClip.start,
          origEndMs: previous.origEndMs ?? oldClip.end,
          renderStatus: "none",
          renderError: undefined,
        };
        await writeFile(path.join(jobDir, "edits.json"), JSON.stringify(edits, null, 2));
        return json({ ok: true, edits });
      }

      const renderMatch = url.pathname.match(/^\/jobs\/([^/]+)\/render$/);
      if (renderMatch && request.method === "POST") {
        const jobId = decodeURIComponent(renderMatch[1]!);
        const job = store.get(jobId);
        if (!job?.result) return json({ error: "Completed job not found" }, 404);
        if (job.status === "queued" || job.status === "running") return json({ error: "Job is already processing" }, 409);
        let mode = job.mode;
        let faceTracking = job.faceTracking;
        let captionsEnabled = job.captionsEnabled;
        let facecamRect = job.facecamRect;
        let renderEveryClip = false;
        if (request.headers.get("content-type")?.includes("application/json")) {
          let payload: unknown;
          try { payload = await request.json(); }
          catch { return json({ error: "Render settings must be valid JSON" }, 400); }
          if (!isRecord(payload)) return json({ error: "Render settings must be a JSON object" }, 400);
          if (payload.mode !== undefined) {
            if (typeof payload.mode !== "string") return json({ error: "mode must be a valid mode name" }, 400);
            try { mode = getMode(payload.mode).name as ModeName; }
            catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
          }
          if (payload.faceTracking !== undefined) {
            if (typeof payload.faceTracking !== "boolean") return json({ error: "faceTracking must be a boolean" }, 400);
            faceTracking = payload.faceTracking;
          }
          if (payload.captionsEnabled !== undefined) {
            if (typeof payload.captionsEnabled !== "boolean") return json({ error: "captionsEnabled must be a boolean" }, 400);
            captionsEnabled = payload.captionsEnabled;
          }
          if (Object.hasOwn(payload, "facecamRect")) {
            if (payload.facecamRect === null) facecamRect = null;
            else if (typeof payload.facecamRect === "string") {
              try { facecamRect = parseFacecamRect(payload.facecamRect); }
              catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
            } else return json({ error: "facecamRect must be normalized x,y,w,h or null for automatic detection" }, 400);
          }
          renderEveryClip = true;
          store.updateRenderSettings(jobId, { mode, faceTracking, captionsEnabled, facecamRect });
        }
        const jobDir = path.join(jobRoot, jobId);
        let edits: Record<string, ClipRenderEdit> = {};
        try { edits = JSON.parse(await readFile(path.join(jobDir, "edits.json"), "utf8")) as Record<string, ClipRenderEdit>; }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
        for (const edit of Object.values(edits)) {
          if (renderEveryClip || edit.renderStatus === "none" || edit.renderStatus === "failed") edit.renderStatus = "queued";
        }
        await writeFile(path.join(jobDir, "edits.json"), JSON.stringify(edits, null, 2));
        store.requeue(jobId);
        queue.enqueue({ id: jobId, videoPath: job.videoPath, force: true, operation: "render", faceTracking, captionsEnabled, onlyStale: !renderEveryClip, mode, facecamRect });
        return json({ job: store.get(jobId) }, 202);
      }

      return json({ error: "Not found" }, 404);
    },
  };
}
