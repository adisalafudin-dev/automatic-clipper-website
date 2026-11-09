import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Transcript } from "../types.ts";
import { renderClips } from "./render.ts";

async function run(args: string[]): Promise<string> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
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
      "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "pcm_s16le", "-ac", "1", source,
    ]);
    const transcript: Transcript = {
      model: "test",
      language: "en",
      words: [
        { text: "Test", start: 100, end: 450 },
        { text: "caption.", start: 500, end: 1000 },
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
    }], false, { "clip-01": "A custom caption line" });
    expect(manifest.clips).toHaveLength(1);
    const editedAss = await Bun.file(path.join(jobDir, "captions", "clip-01.ass")).text();
    expect(editedAss).toContain("custom");
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
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
