import path from "node:path";

export type YouTubeClipRequest = { url: string; start: string; end: string };

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

export function validateYouTubeRequest(value: unknown): YouTubeClipRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Request body must be an object");
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string" || !record.url.trim()) throw new Error("Paste a YouTube video link");
  let url: URL;
  try { url = new URL(record.url.trim()); }
  catch { throw new Error("Enter a valid YouTube URL"); }
  if (url.protocol !== "https:" || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) throw new Error("Only HTTPS YouTube video links are supported");
  if (typeof record.start !== "string" || typeof record.end !== "string") throw new Error("Start and end times are required in HH:MM:SS format");
  const startSeconds = parseTimestamp(record.start);
  const endSeconds = parseTimestamp(record.end);
  if (endSeconds <= startSeconds) throw new Error("End time must be later than start time");
  return { url: url.toString(), start: formatTimestamp(startSeconds), end: formatTimestamp(endSeconds) };
}

function parseTimestamp(value: string): number {
  const match = /^(\d{2,}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("Use HH:MM:SS for start and end times");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) throw new Error("Minutes and seconds must be from 00 to 59");
  return hours * 3600 + minutes * 60 + seconds;
}

function formatTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function buildYouTubeDownloadArgs(request: YouTubeClipRequest, outputDirectory: string): string[] {
  return [
    "--no-playlist", "--newline", "--progress", "--js-runtimes", "deno",
    "-f", "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]",
    "--download-sections", `*${request.start}-${request.end}`,
    "--merge-output-format", "mp4",
    "-o", path.join(outputDirectory, "%(title).180B [%(id)s].%(ext)s"),
    request.url,
  ];
}

export function buildYouTubeMetadataArgs(url: string): string[] {
  return ["--no-playlist", "--skip-download", "--dump-single-json", "--js-runtimes", "deno", url];
}

export function buildYouTubeAnalysisArgs(url: string, outputDirectory: string): string[] {
  return [
    "--no-playlist", "--skip-download", "--write-info-json", "--write-subs", "--write-auto-subs",
    "--sub-langs", "en.*,id.*,live_chat", "--sub-format", "vtt/srt/best", "--js-runtimes", "deno",
    "-o", path.join(outputDirectory, "%(id)s.%(ext)s"), url,
  ];
}

export function buildYouTubeAudioArgs(url: string, outputDirectory: string): string[] {
  return ["--no-playlist", "--max-filesize", "500M", "--extract-audio", "--audio-format", "m4a", "-f", "bestaudio", "--js-runtimes", "deno", "-o", path.join(outputDirectory, "audio.%(ext)s"), url];
}

export function buildYouTubeSectionArgs(url: string, startSeconds: number, endSeconds: number, outputPath: string): string[] {
  return [
    "--no-playlist", "--newline", "--progress", "--js-runtimes", "deno",
    "-f", "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]",
    "--download-sections", `*${formatSeconds(startSeconds)}-${formatSeconds(endSeconds)}`,
    "--merge-output-format", "mp4", "-o", outputPath, url,
  ];
}

function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole % 3600 / 60);
  const remainder = whole % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
