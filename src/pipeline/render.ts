import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Transcript } from "../types.ts";
import type { ClipCandidate } from "./candidates.ts";
import { buildAss, type CaptionStyle } from "./captions.ts";
import { sampleFaceCenters, type FaceCenterSample } from "../vision/faces.ts";

export type ClipRenderEdit = { caption?: string; style?: CaptionStyle; titleOverlay?: boolean };

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
  faceCenters: FaceCenterSample[] = [],
): string[] {
  const seconds = (ms: number) => (ms / 1000).toFixed(3);
  let cropX = "(iw-ow)/2";
  if (faceCenters.length) {
    let expression = faceCenters.at(-1)!.centerX.toFixed(2);
    for (let index = faceCenters.length - 2; index >= 0; index--) {
      const current = faceCenters[index]!;
      const next = faceCenters[index + 1]!;
      const span = Math.max(0.001, next.time - current.time);
      const linear = `${current.centerX.toFixed(2)}+(${(next.centerX - current.centerX).toFixed(2)})*((t-${current.time.toFixed(2)})/${span.toFixed(2)})`;
      expression = `if(lt(t\\,${next.time.toFixed(2)})\\,${linear}\\,${expression})`;
    }
    if (faceCenters.length > 1) {
      cropX = `min(max(if(lt(t\\,${faceCenters[0]!.time.toFixed(2)})\\,${faceCenters[0]!.centerX.toFixed(2)}\\,${expression})-ow/2\\,0)\\,iw-ow)`;
    } else {
      cropX = `min(max(${expression}-ow/2\\,0)\\,iw-ow)`;
    }
  }
  const filter = [
    `crop=w='ih*9/16':h=ih:x='${cropX}':y=0`,
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
  edits: Record<string, ClipRenderEdit> = {},
  faceTracking = false,
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

    const edit = edits[id];
    let faceCenters: FaceCenterSample[] = [];
    if (faceTracking) {
      const trackingStarted = performance.now();
      try {
        faceCenters = await sampleFaceCenters(absoluteVideo, candidate.start, candidate.end);
        console.log(`Face tracking ${id}: ${faceCenters.length} sparse samples in ${((performance.now() - trackingStarted) / 1000).toFixed(2)}s`);
        if (!faceCenters.length) console.warn(`No face found for ${id}; using center crop`);
      } catch (error) {
        console.warn(`Face tracking failed for ${id}; using center crop: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const override = edit?.caption?.trim();
    const duration = candidate.end - candidate.start;
    const overrideWords = override ? override.split(/\s+/) : [];
    const totalCharacters = overrideWords.reduce((total, word) => total + word.length, 0);
    const customWords = overrideWords.map((text, wordIndex) => {
      const before = overrideWords.slice(0, wordIndex).reduce((total, word) => total + word.length, 0);
      const start = candidate.start + Math.floor(duration * before / totalCharacters);
      const end = candidate.start + Math.max(1, Math.floor(duration * (before + text.length) / totalCharacters));
      return { text, start, end };
    });
    await Bun.write(captionsPath, buildAss(
      override ? customWords : transcript.words,
      candidate.start,
      candidate.end,
      { style: edit?.style, title: edit?.titleOverlay ? candidate.title : undefined },
    ));
    if (!force && !faceTracking && (await Bun.file(outputPath).exists())) {
      console.log(`Using cached render: ${outputRelative}`);
    } else {
      const args = buildRenderArgs(
        absoluteVideo,
        outputRelative,
        captionsRelative,
        candidate.start,
        candidate.end,
        faceCenters,
      );
      try {
        await runFfmpeg(args, absoluteJobDir);
      } catch (error) {
        if (!faceTracking || !faceCenters.length) throw error;
        console.warn(`Tracked crop render failed for ${id}; retrying center crop: ${error instanceof Error ? error.message : String(error)}`);
        await runFfmpeg(
          buildRenderArgs(absoluteVideo, outputRelative, captionsRelative, candidate.start, candidate.end),
          absoluteJobDir,
        );
      }
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
