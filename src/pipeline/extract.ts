import { mkdir } from "node:fs/promises";
import path from "node:path";

// Extracts the audio track of a video as 16 kHz mono 16-bit WAV.
export async function extractAudio(
  videoPath: string,
  wavPath: string,
): Promise<void> {
  if (!(await Bun.file(videoPath).exists())) {
    throw new Error(`Video not found: ${videoPath}`);
  }

  // Create the output folder (and parents) if it doesn't exist yet.
  await mkdir(path.dirname(wavPath), { recursive: true });

  const args = [
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error", // quiet: only real errors
    "-y", // overwrite output if it exists
    "-i",
    videoPath, // input file
    "-vn", // no video
    "-ac",
    "1", // mono
    "-ar",
    "16000", // 16 kHz sample rate
    "-c:a",
    "pcm_s16le", // uncompressed 16-bit WAV
    wavPath,
  ];

  const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`ffmpeg failed (exit code ${exitCode}):\n${stderr.trim()}`);
  }
}
