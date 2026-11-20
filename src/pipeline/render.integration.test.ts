import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Transcript } from "../types.ts";
import { buildRenderArgs, renderClips } from "./render.ts";

async function run(args: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${args[0]} failed (${code}): ${stderr}`);
  return stdout;
}

test("renders a tiny FFmpeg fixture as captioned 9:16 normalized video with editable captions", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "clipper-render-"));
  try {
    const source = path.join(temp, "fixture.mp4");
    const jobDir = path.join(temp, "job");
    await run([
      "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000",
      "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "pcm_s16le", "-ac", "1", source,
    ]);
    const transcript: Transcript = {
      model: "test",
      language: "en",
      words: [
        { text: "Test", start: 100, end: 450 },
        { text: "caption.", start: 500, end: 1900 },
      ],
    };
    const manifest = await renderClips(source, jobDir, transcript, [{
      startSentenceId: 0,
      endSentenceId: 0,
      start: 0,
      end: 2000,
      hook: "Fixture hook",
      title: "Fixture",
      score: 8,
      reason: "Integration fixture",
    }], false, { "clip-01": { caption: "A custom caption line", style: "bold", titleOverlay: true } });
    expect(manifest.clips).toHaveLength(1);
    const editedAss = await Bun.file(path.join(jobDir, "captions", "clip-01.ass")).text();
    expect(editedAss).toContain("custom");
    expect(editedAss).toContain("Fixture");
    expect(editedAss).toContain("Style: Default,Arial,74,&H00FFFFFF,&H00FFFFFF,&H00000000");
    expect(editedAss).not.toContain("Test");

    const probeText = await run([
      "ffprobe", "-v", "error", "-show_entries",
      "stream=codec_type,width,height,sample_rate,channels:format=duration",
      "-of", "json", path.join(jobDir, "clips", "clip-01.mp4"),
    ]);
    const probe = JSON.parse(probeText) as {
      streams: Array<{ codec_type: string; width?: number; height?: number; sample_rate?: string; channels?: number }>;
      format: { duration: string };
    };
    const video = probe.streams.find((stream) => stream.codec_type === "video");
    const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    expect(video?.width).toBe(1080);
    expect(video?.height).toBe(1920);
    expect(audio?.sample_rate).toBe("48000");
    expect(audio?.channels).toBe(1);
    expect(Number(probe.format.duration)).toBeGreaterThan(1.8);
    expect(Number(probe.format.duration)).toBeLessThan(2.2);

    const cleanDir = path.join(temp, "no-subtitles");
    const clean = await renderClips(source, cleanDir, transcript, [{
      startSentenceId: 0, endSentenceId: 0, start: 0, end: 2000,
      hook: "Clean hook", title: "Clean", score: 8, reason: "No subtitle fixture",
    }], true, {}, false, "center-crop", undefined, "classic", undefined, false);
    expect(clean.clips[0]!.captions).toBeUndefined();
    expect(await Bun.file(path.join(cleanDir, "captions", "clip-01.ass")).exists()).toBe(false);
    const cleanProbe = await run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "json", path.join(cleanDir, "clips", "clip-01.mp4")]);
    const cleanVideo = (JSON.parse(cleanProbe) as { streams: Array<{ width: number; height: number }> }).streams[0]!;
    expect(cleanVideo).toEqual({ width: 1080, height: 1920 });

    const trackedArgs = buildRenderArgs(source, "clips/tracked.mp4", "captions/clip-01.ass", 0, 2_000, [
      { time: 0.5, centerX: 120 }, { time: 1.5, centerX: 190 },
    ]);
    await run(trackedArgs, jobDir);
    const trackedProbe = await run([
      "ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "json",
      path.join(jobDir, "clips", "tracked.mp4"),
    ]);
    const trackedStreams = (JSON.parse(trackedProbe) as { streams: Array<{ width: number; height: number }> }).streams;
    expect(trackedStreams[0]!.width).toBe(1080);
    expect(trackedStreams[0]!.height).toBe(1920);

    const naturalDir = path.join(temp, "natural");
    const natural = await renderClips(source, naturalDir, {
      model: "test",
      language: "en",
      words: [
        { text: "Wait", start: 0, end: 300 },
        { text: "now.", start: 1600, end: 1900 },
      ],
    }, [{
      startSentenceId: 0,
      endSentenceId: 0,
      start: 0,
      end: 2500,
      hook: "Pause hook",
      title: "Pause",
      score: 8,
      reason: "Pause fixture",
    }], true);
    expect(natural.clips[0]!.duration).toBe(2500);
    expect(natural.clips[0]!.start).toBe(0);
    expect(natural.clips[0]!.end).toBe(2500);
    const naturalAss = await Bun.file(path.join(naturalDir, "captions", "clip-01.ass")).text();
    expect(naturalAss).toContain("Dialogue: 0,0:00:00.00,0:00:01.90");
    expect(naturalAss).toContain("{\\k160}Wait {\\k30}now.");
    const naturalProbe = await run([
      "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json",
      path.join(naturalDir, "clips", "clip-01.mp4"),
    ]);
    const naturalDuration = Number((JSON.parse(naturalProbe) as { format: { duration: string } }).format.duration);
    expect(naturalDuration).toBeGreaterThan(2.3);
    expect(naturalDuration).toBeLessThan(2.7);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 20_000);
