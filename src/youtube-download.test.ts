import { expect, test } from "bun:test";
import { createYouTubeDownloadApi } from "./youtube-download-api.ts";
import path from "node:path";
import { buildYouTubeAnalysisArgs, buildYouTubeAudioArgs, buildYouTubeDownloadArgs, buildYouTubeMetadataArgs, buildYouTubeSectionArgs, validateYouTubeRequest } from "./youtube-download.ts";

test("validates YouTube URLs and normalizes clip timestamps", () => {
  expect(validateYouTubeRequest({ url: "https://youtu.be/abc123", start: "03:00:00", end: "03:35:00" })).toEqual({
    url: "https://youtu.be/abc123", start: "03:00:00", end: "03:35:00",
  });
});

test("rejects non-YouTube hosts, malformed times, and reversed ranges", () => {
  expect(() => validateYouTubeRequest({ url: "https://example.com/video", start: "00:00:00", end: "00:01:00" })).toThrow("Only HTTPS YouTube");
  expect(() => validateYouTubeRequest({ url: "https://youtube.com/watch?v=x", start: "3:00", end: "04:00:00" })).toThrow("HH:MM:SS");
  expect(() => validateYouTubeRequest({ url: "https://youtube.com/watch?v=x", start: "00:02:00", end: "00:01:00" })).toThrow("later than start");
  expect(() => validateYouTubeRequest({ url: "https://youtube.com/watch?v=x", start: "00:60:00", end: "01:01:00" })).toThrow("Minutes and seconds");
});

test("builds yt-dlp arguments as an argument array with a quoted section and output template", () => {
  expect(buildYouTubeDownloadArgs({ url: "https://youtu.be/abc123", start: "03:00:00", end: "03:35:00" }, "data/downloads/job-1")).toEqual([
    "--no-playlist", "--newline", "--progress", "--js-runtimes", "deno",
    "-f", "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]",
    "--download-sections", "*03:00:00-03:35:00",
    "--merge-output-format", "mp4",
    "-o", path.join("data/downloads/job-1", "%(title).180B [%(id)s].%(ext)s"),
    "https://youtu.be/abc123",
  ]);
});

test("builds metadata-only and transcript/chat sidecar yt-dlp commands", () => {
  expect(buildYouTubeMetadataArgs("https://youtu.be/abc123")).toEqual([
    "--no-playlist", "--skip-download", "--dump-single-json", "--js-runtimes", "deno", "https://youtu.be/abc123",
  ]);
  expect(buildYouTubeAnalysisArgs("https://youtu.be/abc123", "data/analysis/job-1")).toEqual([
    "--no-playlist", "--skip-download", "--write-info-json", "--write-subs", "--write-auto-subs",
    "--sub-langs", "en.*,id.*,live_chat", "--sub-format", "vtt/srt/best", "--js-runtimes", "deno",
    "-o", path.join("data/analysis/job-1", "%(id)s.%(ext)s"), "https://youtu.be/abc123",
  ]);
});

test("builds audio-only fallback and single-section download commands", () => {
  expect(buildYouTubeAudioArgs("https://youtu.be/abc123", "audio")).toContain("--max-filesize");
  expect(buildYouTubeSectionArgs("https://youtu.be/abc123", 90, 125, "clip.mp4")).toContain("*00:01:30-00:02:05");
});

test("download API rejects invalid sites before starting yt-dlp", async () => {
  const api = createYouTubeDownloadApi("data/test-downloads");
  const response = await api.fetch(new Request("http://localhost/youtube-downloads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/video", start: "00:00:00", end: "00:01:00" }),
  }));
  expect(response?.status).toBe(400);
  expect(await response?.json()).toEqual({ error: "Only HTTPS YouTube video links are supported" });
});
