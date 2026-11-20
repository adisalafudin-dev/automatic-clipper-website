import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { buildYouTubeDownloadArgs, validateYouTubeRequest } from "./youtube-download.ts";

type DownloadJob = {
  id: string;
  directory: string;
  status: "running" | "completed" | "failed" | "cancelled";
  progress: number;
  filename?: string;
  error?: string;
  controller: AbortController;
};

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

function publicJob(job: DownloadJob) {
  return { id: job.id, status: job.status, progress: job.progress, filename: job.filename, error: job.error };
}

function spawnYtDlp(binary: string, args: string[], signal: AbortSignal) {
  return Bun.spawn([binary, ...args], { stdout: "pipe", stderr: "pipe", signal });
}

async function drainProgress(stream: ReadableStream<Uint8Array>, job: DownloadJob, keepOutput = false): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let output = "";
  while (true) {
    try {
      const item = await reader.read();
      if (item.done) break;
      pending += decoder.decode(item.value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const match = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
        if (match) job.progress = Math.max(0, Math.min(99, Number(match[1])));
        if (keepOutput) output = `${output}${line}\n`.slice(-12_000);
      }
    } catch (error) {
      if (job.controller.signal.aborted) return output;
      throw error;
    }
  }
  if (keepOutput && pending) output = `${output}${pending}`.slice(-12_000);
  return output;
}

async function runDownload(job: DownloadJob, request: ReturnType<typeof validateYouTubeRequest>): Promise<void> {
  const binary = process.env.YT_DLP_BIN ?? (process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  const args = buildYouTubeDownloadArgs(request, job.directory);
  let proc: ReturnType<typeof spawnYtDlp>;
  try {
    proc = spawnYtDlp(binary, args, job.controller.signal);
  } catch (error) {
    job.status = "failed";
    job.error = `Could not start yt-dlp (${binary}). Install yt-dlp or set YT_DLP_BIN. ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  const stdoutPromise = drainProgress(proc.stdout, job);
  const stderrPromise = drainProgress(proc.stderr, job, true);
  const [exitCode, stderr] = await Promise.all([proc.exited, stderrPromise]);
  await stdoutPromise;
  if (job.controller.signal.aborted) {
    job.status = "cancelled";
    await rm(job.directory, { recursive: true, force: true });
    return;
  }
  if (exitCode !== 0) {
    job.status = "failed";
    job.error = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" ") || `yt-dlp exited with code ${exitCode}`;
    await rm(job.directory, { recursive: true, force: true });
    return;
  }
  const files = await readdir(job.directory);
  const filename = files.find((file) => file.toLowerCase().endsWith(".mp4"));
  if (!filename) {
    job.status = "failed";
    job.error = "yt-dlp finished but did not produce an MP4 file. Check that the selected format is available.";
    await rm(job.directory, { recursive: true, force: true });
    return;
  }
  job.filename = filename;
  job.progress = 100;
  job.status = "completed";
}

export function createYouTubeDownloadApi(downloadRoot = path.join("data", "downloads")) {
  const jobs = new Map<string, DownloadJob>();
  return {
    async fetch(request: Request): Promise<Response | undefined> {
      const url = new URL(request.url);
      if (url.pathname === "/youtube-downloads" && request.method === "POST") {
        let payload: unknown;
        try { payload = await request.json(); }
        catch { return response({ error: "Request body must be valid JSON" }, 400); }
        let options: ReturnType<typeof validateYouTubeRequest>;
        try { options = validateYouTubeRequest(payload); }
        catch (error) { return response({ error: error instanceof Error ? error.message : String(error) }, 400); }
        if ([...jobs.values()].some((job) => job.status === "running")) return response({ error: "A YouTube download is already running" }, 409);
        const id = randomUUID();
        const job: DownloadJob = {
          id,
          directory: path.resolve(downloadRoot, id),
          status: "running",
          progress: 0,
          controller: new AbortController(),
        };
        jobs.set(id, job);
        await mkdir(job.directory, { recursive: true });
        void runDownload(job, options).catch(async (error: unknown) => {
          job.status = job.controller.signal.aborted ? "cancelled" : "failed";
          job.error = error instanceof Error ? error.message : String(error);
          if (job.status === "cancelled") await rm(job.directory, { recursive: true, force: true });
        });
        return response({ job: publicJob(job) }, 202);
      }

      const match = /^\/youtube-downloads\/([\da-f-]+)(?:\/(file))?$/.exec(url.pathname);
      if (!match) return undefined;
      const job = jobs.get(match[1]!);
      if (!job) return response({ error: "Download job not found" }, 404);
      if (match[2] === "file" && request.method === "GET") {
        if (job.status !== "completed" || !job.filename) return response({ error: "Download is not ready" }, 409);
        const file = Bun.file(path.join(job.directory, job.filename));
        return new Response(file, {
          headers: {
            "content-type": "video/mp4",
            "content-length": String(file.size),
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(job.filename)}`,
            "cache-control": "no-store",
          },
        });
      }
      if (!match[2] && request.method === "GET") return response({ job: publicJob(job) });
      if (!match[2] && request.method === "DELETE") {
        job.controller.abort();
        if (job.status !== "running") await rm(job.directory, { recursive: true, force: true });
        jobs.delete(job.id);
        return response({ ok: true });
      }
      return response({ error: "Method not allowed" }, 405);
    },
  };
}
