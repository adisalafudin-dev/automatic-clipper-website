import path from "node:path";
import { checkFfmpeg } from "../ffmpeg/check.ts";
import type { Transcript } from "../types.ts";
import { extractAudio } from "./extract.ts";
import { RouterClient } from "./llm.ts";
import { renderClips, type ClipsManifest } from "./render.ts";
import { selectCandidates } from "./select.ts";
import { transcribe } from "./transcribe.ts";
import type { ClipCandidate } from "./candidates.ts";

export const PIPELINE_STAGES = [
  "audio_extraction",
  "transcription",
  "selection",
  "rendering",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type PipelineProgress = (stage: PipelineStage, progress: number) => void;

export type PipelineResult = {
  manifest: ClipsManifest;
  transcriptWords: number;
  candidateCount: number;
};

export type PipelineOptions = { faceTracking?: boolean };

export async function runPipeline(
  videoPath: string,
  jobDir: string,
  force = false,
  reportProgress: PipelineProgress = () => {},
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const startedAt = performance.now();
  await checkFfmpeg();

  const timedStage = async <T>(stageName: PipelineStage, work: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    reportProgress(stageName, 0);
    const result = await work();
    reportProgress(stageName, 100);
    console.log(`${stageName}: ${((performance.now() - start) / 1000).toFixed(2)}s`);
    return result;
  };

  const wavPath = path.join(jobDir, "audio", "audio.wav");
  await timedStage("audio_extraction", async () => {
    if (force || !(await Bun.file(wavPath).exists())) {
      await extractAudio(videoPath, wavPath);
    } else {
      console.log(`Using cached audio: ${wavPath}`);
    }
  });

  const transcript: Transcript = await timedStage("transcription", () =>
    transcribe(wavPath, jobDir, force),
  );

  const candidatesPath = path.join(jobDir, "candidates.json");
  const candidates: ClipCandidate[] = await timedStage("selection", async () => {
    if (!force && (await Bun.file(candidatesPath).exists())) {
      console.log(`Using cached candidates: ${candidatesPath}`);
      return (await Bun.file(candidatesPath).json()) as ClipCandidate[];
    }
    const selected = await selectCandidates(transcript, new RouterClient());
    await Bun.write(candidatesPath, JSON.stringify(selected, null, 2));
    return selected;
  });

  const manifest = await timedStage("rendering", () =>
    renderClips(videoPath, jobDir, transcript, candidates, force, {}, options.faceTracking === true),
  );
  console.log(`Total: ${((performance.now() - startedAt) / 1000).toFixed(2)}s`);
  return { manifest, transcriptWords: transcript.words.length, candidateCount: candidates.length };
}
