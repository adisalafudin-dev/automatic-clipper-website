import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Transcript } from "./types.ts";
import type { ClipCandidate } from "./pipeline/candidates.ts";
import { RouterClient } from "./pipeline/llm.ts";
import { selectCandidates } from "./pipeline/select.ts";
import { extractAudio } from "./pipeline/extract.ts";
import { transcribe } from "./pipeline/transcribe.ts";
import { splitSentences, transcriptSentences } from "./pipeline/sentences.ts";
import { saveJobMetadata } from "./job-metadata.ts";
import { getMode, parseFacecamRect, type ModeName } from "./modes.ts";
import { defaultProjectName, normalizeProjectName } from "./project-name.ts";
import { JobQueue } from "./state/queue.ts";
import { JobStore } from "./state/jobs.ts";
import {
  buildActivityWindows, captionsToTranscript, extractHeatmap, parseCaptionCues, parseLiveChatJsonl, selectSpikeRanges,
  type YouTubeAnalysisSignals,
} from "./youtube-analysis.ts";
import { buildYouTubeAnalysisArgs, buildYouTubeAudioArgs, buildYouTubeMetadataArgs, buildYouTubeSectionArgs, isYouTubeRateLimitError, validateYouTubeRequest } from "./youtube-download.ts";

const MAX_AUDIO_FALLBACK_BYTES = 500 * 1024 * 1024;
const MAX_ANALYSIS_DOWNLOAD_BYTES = 500 * 1024 * 1024;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

type InfoJson = { id?: string; title?: string; duration?: number; channel?: string; uploader?: string; live_status?: string; is_live?: boolean; heatmap?: unknown; chapters?: unknown; formats?: unknown };
type AnalysisStatus = "running" | "completed" | "creating" | "failed" | "cancelled";
type AnalysisResult = {
  url: string; videoId: string; title: string; duration: number; channel: string; language: string;
  transcript: Transcript; candidates: ClipCandidate[]; signals: YouTubeAnalysisSignals; warnings: string[];
};
type AnalysisJob = {
  id: string; directory: string; status: AnalysisStatus; stage: string; progress: number;
  error?: string; result?: AnalysisResult; projectId?: string; controller: AbortController;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function response(body: unknown, status = 200): Response { return Response.json(body, { status }); }

async function directoryBytes(directory: string): Promise<number> {
  let files: string[];
  try { files = await readdir(directory); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0; throw error; }
  let total = 0;
  for (const file of files) {
    try { total += (await stat(path.join(directory, file))).size; }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  }
  return total;
}

function publicJob(job: AnalysisJob) {
  return {
    id: job.id, status: job.status, stage: job.stage, progress: job.progress,
    ...(job.error ? { error: job.error } : {}), ...(job.projectId ? { projectId: job.projectId } : {}),
    ...(job.result ? { result: {
      videoId: job.result.videoId, title: job.result.title, duration: job.result.duration,
      channel: job.result.channel, language: job.result.language,
      candidates: job.result.candidates, signals: job.result.signals,
      warnings: job.result.warnings,
    } } : {}),
  };
}

async function runProcess(binary: string, args: string[], signal: AbortSignal, maximumDirectoryBytes?: { directory: string; limit: number }): Promise<{ stdout: string; stderr: string }> {
  const childController = new AbortController();
  const abortChild = () => childController.abort();
  signal.addEventListener("abort", abortChild, { once: true });
  let sizeLimitExceeded = false;
  let processExited = false;
  const processHandle = (() => {
    try { return Bun.spawn([binary, ...args], { stdout: "pipe", stderr: "pipe", signal: childController.signal }); }
    catch (error) {
      signal.removeEventListener("abort", abortChild);
      throw new Error(`Could not start ${binary}. ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
  const codePromise = processHandle.exited.then((code) => { processExited = true; return code; });
  const stdout = new Response(processHandle.stdout).text();
  const stderr = new Response(processHandle.stderr).text();
  const sizeMonitor = (async () => {
    if (!maximumDirectoryBytes) return;
    while (!processExited && !signal.aborted) {
      await Bun.sleep(500);
      const bytes = await directoryBytes(maximumDirectoryBytes.directory);
      if (bytes > maximumDirectoryBytes.limit) {
        sizeLimitExceeded = true;
        childController.abort();
        return;
      }
    }
  })();
  const [code, out, err] = await Promise.all([codePromise, stdout, stderr, sizeMonitor]).then(([exitCode, outText, errText]) => [exitCode, outText, errText] as const);
  signal.removeEventListener("abort", abortChild);
  if (sizeLimitExceeded) throw new Error("YouTube metadata or selected media exceeded the 500 MB download limit; the current task was stopped.");
  if (signal.aborted) throw new Error("YouTube analysis cancelled");
  if (code !== 0) throw new Error(err.trim().split(/\r?\n/).filter(Boolean).slice(-4).join(" ") || `yt-dlp exited with code ${code}`);
  return { stdout: out, stderr: err };
}

async function ffprobeDuration(filePath: string, signal: AbortSignal): Promise<number> {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], { stdout: "pipe", stderr: "pipe", signal });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code !== 0) throw new Error(`Could not inspect downloaded section: ${err.trim()}`);
  const duration = Number(out.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Downloaded section has an invalid duration");
  return duration * 1000;
}

async function concatSections(files: string[], outputPath: string, jobDirectory: string, signal: AbortSignal): Promise<void> {
  const concatPath = path.join(jobDirectory, "sections.txt");
  const concatList = files.map((file) => `file '${path.relative(jobDirectory, file).replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(concatPath, `${concatList}\n`);
  const args = ["-y", "-f", "concat", "-safe", "0", "-i", "sections.txt", "-c", "copy", "-movflags", "+faststart", path.basename(outputPath)];
  let proc = Bun.spawn(["ffmpeg", ...args], { cwd: jobDirectory, stdout: "ignore", stderr: "pipe", signal });
  let stderr = await new Response(proc.stderr).text();
  let code = await proc.exited;
  if (signal.aborted) throw new Error("YouTube project creation cancelled");
  if (code !== 0) {
    await rm(outputPath, { force: true });
    proc = Bun.spawn(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", "sections.txt", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", path.basename(outputPath)], { cwd: jobDirectory, stdout: "ignore", stderr: "pipe", signal });
    stderr = await new Response(proc.stderr).text();
    code = await proc.exited;
  }
  if (signal.aborted) throw new Error("YouTube project creation cancelled");
  if (code !== 0) throw new Error(`Could not join selected sections into a render source: ${stderr.trim()}`);
  await rm(concatPath, { force: true });
}

function infoChapters(info: InfoJson): Array<{ start: number; end: number; title: string }> {
  if (!Array.isArray(info.chapters)) return [];
  return info.chapters.flatMap((item) => {
    if (!isRecord(item)) return [];
    const start = Number(item.start_time);
    const end = Number(item.end_time);
    const title = typeof item.title === "string" ? item.title.trim() : "";
    return Number.isFinite(start) && Number.isFinite(end) && end > start && title
      ? [{ start: start * 1000, end: end * 1000, title }]
      : [];
  });
}

function captionFiles(files: string[]): string[] {
  return files.filter((file) => /\.(vtt|srt)$/i.test(file) && !/\.live_chat\./i.test(file)).sort((a, b) => {
    const rank = (file: string) => /\.en(?:[-.]|\.)/i.test(file) ? 0 : /\.id(?:[-.]|\.)/i.test(file) ? 1 : 2;
    return rank(a) - rank(b);
  });
}

function languageFromCaption(filename: string): string {
  const match = /\.([a-z]{2,3})(?:-[A-Za-z0-9]+)?\.(?:vtt|srt)$/i.exec(filename);
  return match?.[1]?.toLowerCase() ?? "auto";
}

export function estimatedAudioBytes(info: InfoJson): number {
  if (Array.isArray(info.formats)) {
    const audioFormats = info.formats.filter((format): format is Record<string, unknown> =>
      isRecord(format) && typeof format.acodec === "string" && format.acodec !== "none" && format.vcodec === "none");
    const withBitrate = audioFormats.filter((format) => Number(format.abr) > 0);
    const underLimit = withBitrate.filter((format) => Number(format.abr) <= 64);
    const selected = (underLimit.length ? underLimit : withBitrate)
      .sort((a, b) => underLimit.length ? Number(b.abr) - Number(a.abr) : Number(a.abr) - Number(b.abr))[0];
    const smallestKnown = [...audioFormats].sort((a, b) =>
      Number(a.filesize ?? a.filesize_approx ?? Number.MAX_SAFE_INTEGER) - Number(b.filesize ?? b.filesize_approx ?? Number.MAX_SAFE_INTEGER))[0];
    const chosen = selected ?? smallestKnown;
    const exact = Number(chosen?.filesize ?? chosen?.filesize_approx);
    if (Number.isFinite(exact) && exact > 0) return exact;
    const abr = Number(chosen?.abr);
    if (Number.isFinite(abr) && abr > 0 && Number.isFinite(info.duration)) return info.duration! * abr * 1000 / 8;
  }
  return Number.isFinite(info.duration) ? info.duration! * 320_000 / 8 : MAX_AUDIO_FALLBACK_BYTES + 1;
}

function transcriptLanguage(language: string): "auto" | "en" | "id" {
  return language.toLowerCase().startsWith("id") ? "id" : language.toLowerCase().startsWith("en") ? "en" : "auto";
}

export function createYouTubeAnalysisApi(
  store: JobStore,
  queue: JobQueue,
  options: { analysisRoot?: string; jobRoot?: string } = {},
) {
  const analysisRoot = options.analysisRoot ?? path.join("data", "youtube-analysis");
  const jobRoot = options.jobRoot ?? path.join("data", "jobs");
  const jobs = new Map<string, AnalysisJob>();
  const binary = process.env.YT_DLP_BIN ?? (process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

  async function analyze(job: AnalysisJob, url: string): Promise<void> {
    try {
      job.stage = "Reading YouTube metadata"; job.progress = 5;
      const metadataOutput = await runProcess(binary, buildYouTubeMetadataArgs(url), job.controller.signal);
      let info: InfoJson;
      try { info = JSON.parse(metadataOutput.stdout) as InfoJson; }
      catch { throw new Error("yt-dlp returned invalid video metadata"); }
      if (info.is_live === true || info.live_status === "is_live") throw new Error("This video is still live. Analyze its replay after the stream has ended so the timestamps and chat replay are complete.");
      const duration = Number(info.duration);
      if (!Number.isFinite(duration) || duration < 30) throw new Error("Video duration is unavailable or shorter than 30 seconds");

      job.stage = "Downloading captions, chat, and metadata"; job.progress = 15;
      const warnings: string[] = [];
      let captionRateLimited = false;
      try {
        await runProcess(binary, buildYouTubeAnalysisArgs(url, job.directory), job.controller.signal, { directory: job.directory, limit: MAX_ANALYSIS_DOWNLOAD_BYTES });
      } catch (error) {
        if (!isYouTubeRateLimitError(error)) throw error;
        captionRateLimited = true;
        warnings.push("YouTube rate-limited subtitle requests (HTTP 429); switching to audio-only local transcription.");
        job.stage = "Subtitle requests were rate-limited; switching to audio fallback";
        job.progress = 22;
      }
      const files = await readdir(job.directory);
      const infoFile = files.find((file) => file.endsWith(".info.json"));
      if (infoFile) {
        try { info = JSON.parse(await readFile(path.join(job.directory, infoFile), "utf8")) as InfoJson; }
        catch { /* Keep the first metadata response if sidecar metadata cannot be parsed. */ }
      }
      const availableCaption = captionRateLimited ? undefined : captionFiles(files)[0];
      let transcript: Transcript;
      if (availableCaption) {
        const cues = parseCaptionCues(await readFile(path.join(job.directory, availableCaption), "utf8"));
        transcript = captionsToTranscript(cues, languageFromCaption(availableCaption));
        if (!transcript.words.length) throw new Error("YouTube subtitle file was present but contained no usable captions");
      } else {
        const estimated = estimatedAudioBytes(info);
        if (estimated > MAX_AUDIO_FALLBACK_BYTES) {
          const reason = captionRateLimited ? "YouTube rate-limited captions and " : "No captions are available; ";
          throw new Error(`${reason}the estimated audio-only fallback is ${Math.ceil(estimated / 1024 / 1024)} MB, over the 500 MB limit; no audio was downloaded.`);
        }
        job.stage = "Downloading audio-only fallback"; job.progress = 30;
        await runProcess(binary, buildYouTubeAudioArgs(url, job.directory), job.controller.signal);
        const audio = (await readdir(job.directory)).find((file) => /^audio\./i.test(file) && /\.(m4a|mp3|opus|webm)$/i.test(file));
        if (!audio) throw new Error("yt-dlp did not produce the audio-only fallback file");
        job.stage = "Transcribing audio locally"; job.progress = 40;
        const audioPath = path.join(job.directory, audio);
        const wavPath = path.join(job.directory, "audio.wav");
        await extractAudio(audioPath, wavPath, job.controller.signal);
        transcript = await transcribe(wavPath, job.directory, false, "auto", job.controller.signal);
      }

      job.stage = "Analyzing activity and finding moments"; job.progress = 65;
      const chatFile = files.find((file) => file.endsWith(".live_chat.json"));
      const chat = chatFile ? parseLiveChatJsonl(await readFile(path.join(job.directory, chatFile), "utf8")) : [];
      const heatmap = extractHeatmap(info.heatmap);
      const signals = buildActivityWindows(duration * 1000, chat, heatmap, infoChapters(info));
      const llm = new RouterClient(process.env, job.controller.signal);
      const ranges = selectSpikeRanges(signals.windows, duration * 1000);
      let selectedCandidates: ClipCandidate[] = [];
      for (const range of ranges) {
        const rangeTranscript = { ...transcript, words: transcript.words.filter((word) => word.start < range.end && word.end > range.start) };
        if (!rangeTranscript.words.length) continue;
        const rangeSignals = signals.windows.filter((window) => window.start < range.end && window.end > range.start);
        const rangeChapters = signals.chapters.filter((chapter) => chapter.start < range.end && chapter.end > range.start);
        try {
          const found = await selectCandidates(rangeTranscript, llm, new Map(), 0, rangeSignals, rangeChapters, 1);
          selectedCandidates.push(...found);
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : String(error));
          console.warn(`Skipping YouTube activity window at ${range.start} ms: ${warnings.at(-1)}`);
        }
      }
      if (!selectedCandidates.length) selectedCandidates = await selectCandidates(transcript, llm, new Map(), 0, signals.windows, signals.chapters);
      const rankedCandidates = [...selectedCandidates].sort((a, b) => b.score - a.score || a.start - b.start);
      const nonOverlapping: ClipCandidate[] = [];
      for (const candidate of rankedCandidates) {
        if (nonOverlapping.some((existing) => candidate.start < existing.end && candidate.end > existing.start)) continue;
        nonOverlapping.push(candidate);
        if (nonOverlapping.length >= 10) break;
      }
      const candidates = nonOverlapping.sort((a, b) => a.start - b.start)
        .map((candidate, index) => ({ ...candidate, id: candidate.id ?? `clip-${String(index + 1).padStart(2, "0")}` }));
      const result: AnalysisResult = {
        url, videoId: info.id ?? "youtube-video", title: info.title?.trim() || info.id || "YouTube video",
        duration: duration * 1000, channel: info.channel ?? info.uploader ?? "", language: transcript.language,
        transcript, candidates, signals, warnings,
      };
      await writeFile(path.join(job.directory, "analysis.json"), JSON.stringify(result, null, 2));
      job.result = result; job.status = "completed"; job.stage = "Analysis complete"; job.progress = 100;
    } catch (error) {
      job.status = job.controller.signal.aborted ? "cancelled" : "failed";
      job.error = error instanceof Error ? error.message : String(error);
      job.stage = job.status === "cancelled" ? "Cancelled" : "Analysis failed";
      if (job.status === "cancelled") await rm(job.directory, { recursive: true, force: true });
    }
  }

  async function createProject(job: AnalysisJob, payload: Record<string, unknown>): Promise<void> {
    const result = job.result!;
    const selectedIds = payload.candidateIds;
    if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.some((id) => typeof id !== "string")) throw new Error("Choose at least one AI-selected moment");
    const uniqueIds = [...new Set(selectedIds as string[])];
    const selected = uniqueIds.map((id) => result.candidates.find((candidate) => candidate.id === id));
    if (selected.some((candidate) => !candidate)) throw new Error("One or more selected moments are no longer available");
    if (selected.length > 10) throw new Error("Choose no more than 10 moments");
    const mode = typeof payload.mode === "string" ? getMode(payload.mode).name as ModeName : "default";
    const faceTracking = payload.faceTracking === true;
    const captionsEnabled = payload.captionsEnabled !== false;
    const facecamRect = typeof payload.facecamRect === "string" ? parseFacecamRect(payload.facecamRect) : null;

    job.status = "creating"; job.stage = "Downloading selected moments"; job.progress = 0;
    const id = randomUUID();
    const projectDirectory = path.resolve(jobRoot, id);
    const sourceDirectory = path.join(projectDirectory, "source-sections");
    let dbCreated = false;
    try {
      await mkdir(sourceDirectory, { recursive: true });
      const sectionPaths: string[] = [];
      const durations: number[] = [];
      for (const [index, candidate] of selected.entries()) {
        if (!candidate) continue;
        if (job.controller.signal.aborted) throw new Error("YouTube project creation cancelled");
        const filename = `section-${String(index + 1).padStart(2, "0")}.mp4`;
        const sectionPath = path.join(sourceDirectory, filename);
        job.stage = `Downloading clip ${index + 1} of ${selected.length}`;
        job.progress = Math.round(index / selected.length * 65);
        const request = validateYouTubeRequest({ url: result.url, start: toTimestamp(candidate.start / 1000), end: toTimestamp(candidate.end / 1000) });
        await runProcess(binary, buildYouTubeSectionArgs(request.url, candidate.start / 1000, candidate.end / 1000, sectionPath), job.controller.signal, { directory: sourceDirectory, limit: MAX_ANALYSIS_DOWNLOAD_BYTES });
        sectionPaths.push(sectionPath);
        durations.push(await ffprobeDuration(sectionPath, job.controller.signal));
      }

      job.stage = "Preparing selected clips"; job.progress = 70;
      const sourcePath = path.join(projectDirectory, "source.mp4");
      await concatSections(sectionPaths, sourcePath, projectDirectory, job.controller.signal);
      const words: Transcript["words"] = [];
      const mappedCandidates: ClipCandidate[] = [];
      let offset = 0;
      for (const [index, candidate] of selected.entries()) {
        if (!candidate) continue;
        const actualDuration = durations[index]!;
        const originalDuration = Math.max(1, candidate.end - candidate.start);
        const ratio = actualDuration / originalDuration;
        const segmentWords = result.transcript.words.filter((word) => word.start < candidate.end && word.end > candidate.start);
        for (const word of segmentWords) {
          const start = offset + Math.max(0, word.start - candidate.start) * ratio;
          const end = offset + Math.min(originalDuration, word.end - candidate.start) * ratio;
          if (end > start) words.push({ ...word, start: Math.round(start), end: Math.round(end) });
        }
        mappedCandidates.push({ ...candidate, start: offset, end: offset + actualDuration });
        offset += actualDuration;
      }
      let transcript = { ...result.transcript, words };
      if (result.transcript.model === "youtube-captions") {
        job.stage = "Refining caption timestamps locally"; job.progress = 82;
        const wavPath = path.join(projectDirectory, "audio", "audio.wav");
        await extractAudio(sourcePath, wavPath, job.controller.signal);
        transcript = await transcribe(wavPath, projectDirectory, true, result.language, job.controller.signal);
      }
      const sentences = splitSentences(transcript.words);
      const finalCandidates = mappedCandidates.map((candidate) => {
        const first = sentences.find((sentence) => sentence.end > candidate.start && sentence.start < candidate.end);
        const last = [...sentences].reverse().find((sentence) => sentence.start < candidate.end && sentence.end > candidate.start);
        if (!first || !last) throw new Error(`Could not map transcript timestamps for clip ${candidate.id}`);
        return { ...candidate, startSentenceId: first.id, endSentenceId: last.id };
      });
      await writeFile(path.join(projectDirectory, "transcript.json"), JSON.stringify(transcript, null, 2));
      await writeFile(path.join(projectDirectory, "candidates.json"), JSON.stringify(finalCandidates, null, 2));
      await writeFile(path.join(projectDirectory, "youtube-source.json"), JSON.stringify({ url: result.url, videoId: result.videoId, title: result.title, selectedCandidateIds: uniqueIds }, null, 2));
      if (await Bun.file(path.join(job.directory, "analysis.json")).exists()) await copyFile(path.join(job.directory, "analysis.json"), path.join(projectDirectory, "youtube-analysis.json"));
      await rm(sourceDirectory, { recursive: true, force: true });
      await saveJobMetadata(projectDirectory, { mode });
      const language = transcriptLanguage(transcript.language);
      const jobRecord = store.create(id, sourcePath, faceTracking, language, mode, facecamRect, normalizeProjectName(result.title || defaultProjectName(sourcePath)), captionsEnabled);
      dbCreated = true;
      queue.enqueue({ id, videoPath: sourcePath, force: false, faceTracking, captionsEnabled, language, mode, facecamRect });
      job.projectId = jobRecord.id; job.status = "completed"; job.stage = "Project created"; job.progress = 100;
      await rm(job.directory, { recursive: true, force: true });
    } catch (error) {
      if (dbCreated) store.remove(id);
      await rm(projectDirectory, { recursive: true, force: true });
      job.status = job.controller.signal.aborted ? "cancelled" : "failed";
      job.error = error instanceof Error ? error.message : String(error);
      job.stage = "Project creation failed";
    }
  }

  return {
    async fetch(request: Request): Promise<Response | undefined> {
      const url = new URL(request.url);
      if (url.pathname === "/youtube-analysis" && request.method === "POST") {
        let payload: unknown;
        try { payload = await request.json(); } catch { return response({ error: "Request body must be valid JSON" }, 400); }
        if (!isRecord(payload) || typeof payload.url !== "string") return response({ error: "Paste a YouTube video link" }, 400);
        let parsedUrl: URL;
        try { parsedUrl = new URL(payload.url); } catch { return response({ error: "Enter a valid YouTube URL" }, 400); }
        if (parsedUrl.protocol !== "https:" || !YOUTUBE_HOSTS.has(parsedUrl.hostname.toLowerCase())) return response({ error: "Only HTTPS YouTube video links are supported" }, 400);
        if ([...jobs.values()].some((item) => item.status === "running" || item.status === "creating")) return response({ error: "A YouTube analysis or clip creation is already running" }, 409);
        const id = randomUUID();
        const directory = path.resolve(analysisRoot, id);
        await mkdir(directory, { recursive: true });
        const job: AnalysisJob = { id, directory, status: "running", stage: "Queued", progress: 0, controller: new AbortController() };
        jobs.set(id, job);
        void analyze(job, parsedUrl.toString());
        return response({ job: publicJob(job) }, 202);
      }

      const match = /^\/youtube-analysis\/([\da-f-]+)(?:\/(create-project))?$/.exec(url.pathname);
      if (!match) return undefined;
      const job = jobs.get(match[1]!);
      if (!job) return response({ error: "YouTube analysis job not found" }, 404);
      if (match[2] === "create-project" && request.method === "POST") {
        if (job.status !== "completed" || !job.result) return response({ error: "Analysis must finish before creating clips" }, 409);
        let payload: unknown;
        try { payload = await request.json(); } catch { return response({ error: "Request body must be valid JSON" }, 400); }
        if (!isRecord(payload)) return response({ error: "Request body must be an object" }, 400);
        try {
          if (payload.mode !== undefined) {
            if (typeof payload.mode !== "string") return response({ error: "mode must be a mode name" }, 400);
            getMode(payload.mode);
          }
          if (payload.faceTracking !== undefined && typeof payload.faceTracking !== "boolean") return response({ error: "faceTracking must be a boolean" }, 400);
          if (payload.captionsEnabled !== undefined && typeof payload.captionsEnabled !== "boolean") return response({ error: "captionsEnabled must be a boolean" }, 400);
          if (payload.facecamRect !== undefined && typeof payload.facecamRect !== "string") return response({ error: "facecamRect must be x,y,w,h using normalized values" }, 400);
          if (typeof payload.facecamRect === "string") parseFacecamRect(payload.facecamRect);
          const selectedIds = payload.candidateIds;
          if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.some((value) => typeof value !== "string")) return response({ error: "Choose at least one AI-selected moment" }, 400);
          if (selectedIds.length > 10) return response({ error: "Choose no more than 10 moments" }, 400);
        } catch (error) { return response({ error: error instanceof Error ? error.message : String(error) }, 400); }
        void createProject(job, payload).catch((error: unknown) => {
          job.status = "failed"; job.stage = "Project creation failed"; job.error = error instanceof Error ? error.message : String(error);
        });
        return response({ job: publicJob(job) }, 202);
      }
      if (!match[2] && request.method === "GET") return response({ job: publicJob(job) });
      if (!match[2] && request.method === "DELETE") {
        const wasRunning = job.status === "running" || job.status === "creating";
        job.controller.abort();
        if (!wasRunning) await rm(job.directory, { recursive: true, force: true });
        jobs.delete(job.id);
        return response({ ok: true });
      }
      return response({ error: "Method not allowed" }, 405);
    },
  };
}

function toTimestamp(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole % 3600 / 60);
  const seconds = whole % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
