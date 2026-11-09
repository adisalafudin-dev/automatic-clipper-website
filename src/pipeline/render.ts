import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Transcript } from "../types.ts";
import type { ClipCandidate } from "./candidates.ts";
import { buildAss } from "./captions.ts";

export type RenderedClip = {
  id: string;
  file: string;
  captions: string;
  start: number;
  end: number;
  duration: number;
  startSentenceId: number;
  endSentenceId: number;
  title: string;
  hook: string;
  score: number;
  reason: string;
};

export type ClipsManifest = { source: string; clips: RenderedClip[] };

function slashPath(filePath: string): string {
  return filePath.replaceAll(path.sep, "/");
}

export function buildRenderArgs(
  input: string,
  output: string,
  assRelative: string,
  start: number,
  end: number,
): string[] {
  const seconds = (ms: number) => (ms / 1000).toFixed(3);
  const filter = [
    "crop=w='ih*9/16':h=ih:x='(iw-ow)/2':y=0",
    "scale=1080:1920",
    `subtitles=filename='${slashPath(assRelative)}'`,
  ].join(",");
  return [
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    "-ss", seconds(start), "-i", input, "-t", seconds(end - start),
    "-vf", filter,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "1",
    "-movflags", "+faststart", output,
  ];
}

async function runFfmpeg(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg render failed (exit code ${code}):\n${stderr.trim()}`);
}

export async function renderClips(
  videoPath: string,
  jobDir: string,
  transcript: Transcript,
  candidates: ClipCandidate[],
  force = false,
  captionOverrides: Record<string, string> = {},
): Promise<ClipsManifest> {
  const absoluteJobDir = path.resolve(jobDir);
  const absoluteVideo = path.resolve(videoPath);
  const clipsDir = path.join(absoluteJobDir, "clips");
  const captionsDir = path.join(absoluteJobDir, "captions");
  await mkdir(clipsDir, { recursive: true });
  await mkdir(captionsDir, { recursive: true });

  const clips: RenderedClip[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const id = `clip-${String(index + 1).padStart(2, "0")}`;
    const filename = `${id}.mp4`;
    const captionsFilename = `${id}.ass`;
    const outputRelative = slashPath(path.join("clips", filename));
    const captionsRelative = slashPath(path.join("captions", captionsFilename));
    const outputPath = path.join(clipsDir, filename);
    const captionsPath = path.join(captionsDir, captionsFilename);

    const override = captionOverrides[id]?.trim();
    const duration = candidate.end - candidate.start;
    const overrideWords = override ? override.split(/\s+/) : [];
    const totalCharacters = overrideWords.reduce((total, word) => total + word.length, 0);
    const customWords = overrideWords.map((text, wordIndex) => {
      const before = overrideWords.slice(0, wordIndex).reduce((total, word) => total + word.length, 0);
      const start = candidate.start + Math.floor(duration * before / totalCharacters);
      const end = candidate.start + Math.max(1, Math.floor(duration * (before + text.length) / totalCharacters));
      return { text, start, end };
    });
    await Bun.write(captionsPath, buildAss(override ? customWords : transcript.words, candidate.start, candidate.end));
    if (!force && (await Bun.file(outputPath).exists())) {
      console.log(`Using cached render: ${outputRelative}`);
    } else {
      const args = buildRenderArgs(
        absoluteVideo,
        outputRelative,
        captionsRelative,
        candidate.start,
        candidate.end,
      );
      await runFfmpeg(args, absoluteJobDir);
    }

    clips.push({
      id,
      file: outputRelative,
      captions: captionsRelative,
      start: candidate.start,
      end: candidate.end,
      duration: candidate.end - candidate.start,
      startSentenceId: candidate.startSentenceId,
      endSentenceId: candidate.endSentenceId,
      title: candidate.title,
      hook: candidate.hook,
      score: candidate.score,
      reason: candidate.reason,
    });
  }

  const manifest = { source: videoPath, clips };
  await Bun.write(path.join(absoluteJobDir, "clips.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
