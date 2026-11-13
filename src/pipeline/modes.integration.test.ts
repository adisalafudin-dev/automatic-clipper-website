import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runPipeline } from "./run.ts";
import type { Transcript } from "../types.ts";

async function run(args: string[]): Promise<void> {
  const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${args[0]} failed (${code}): ${stderr}`);
}

test("runs cached short end-to-end jobs for all content modes", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "clipper-modes-e2e-"));
  try {
    const source = path.join(temp, "fixture.mp4");
    await run([
      "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000",
      "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "pcm_s16le", "-ac", "1", source,
    ]);
    const transcript: Transcript = {
      model: "cached-fixture", language: "en", words: [
        { text: "Wkwk", start: 100, end: 400 }, { text: "streamer", start: 420, end: 850 },
        { text: "wins!", start: 900, end: 1200 }, { text: "nice", start: 1300, end: 1600 },
        { text: "play.", start: 1650, end: 2300 },
      ],
    };
    for (const mode of ["default", "gaming", "podcast"] as const) {
      const jobDir = path.join(temp, `job-${mode}`);
      await mkdir(jobDir, { recursive: true });
      await Bun.write(path.join(jobDir, "transcript.json"), JSON.stringify(transcript));
      await Bun.write(path.join(jobDir, "candidates.json"), JSON.stringify([{
        id: "clip-01", startSentenceId: 0, endSentenceId: 0, start: 0, end: 2800,
        hook: "Streamer wins", title: "A great play", score: 8, reason: "Fixture candidate",
      }]));
      await Bun.write(path.join(jobDir, "clips.json"), JSON.stringify({
        source, mode, clips: [{ id: "clip-01", metadata: { title: "Judul", description: "Deskripsi", hashtags: ["gaming"] } }],
      }));

      const result = await runPipeline(source, jobDir, false, undefined, { mode });
      expect(result.manifest.mode).toBe(mode);
      expect(result.manifest.clips[0]!.metadata?.title).toBe("Judul");
      const ass = await Bun.file(path.join(jobDir, "captions", "clip-01.ass")).text();
      expect(ass).toContain(mode === "gaming" ? "Arial,74" : mode === "podcast" ? "Arial,58" : "Arial,66");
      if (mode === "gaming") {
        const corrected = await Bun.file(path.join(jobDir, "transcript.json")).json() as Transcript;
        expect(corrected.words[0]!.text).toBe("tertawa");
      }
      const probeProc = Bun.spawn([
        "ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "json",
        path.join(jobDir, "clips", "clip-01.mp4"),
      ], { stdout: "pipe", stderr: "pipe" });
      const [probeOut, probeErr, probeCode] = await Promise.all([
        new Response(probeProc.stdout).text(), new Response(probeProc.stderr).text(), probeProc.exited,
      ]);
      if (probeCode !== 0) throw new Error(`ffprobe failed (${probeCode}): ${probeErr}`);
      const probe = JSON.parse(probeOut) as { streams: Array<{ width: number; height: number }> };
      expect(probe.streams[0]).toMatchObject({ width: 1080, height: 1920 });
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 15_000);
