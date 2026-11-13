import path from "node:path";
import { checkFfmpeg } from "../ffmpeg/check.ts";
import type { Transcript } from "../types.ts";
import { extractAudio } from "./extract.ts";
import { RouterClient } from "./llm.ts";
import { renderClips, type ClipsManifest } from "./render.ts";
import { selectCandidates } from "./select.ts";
import { transcribe } from "./transcribe.ts";
import type { ClipCandidate } from "./candidates.ts";
import type { ModeName } from "../modes.ts";
import { getMode, type FacecamRect } from "../modes.ts";
import { readJobMetadata, resolveJobMode, saveJobMetadata } from "../job-metadata.ts";
import { loadOrComputeAudioEnergy } from "./audio-energy.ts";
import { transcriptSentences } from "./sentences.ts";
import { applyModeGlossary } from "./glossary.ts";
import { generateClipMetadata, type ClipMetadata } from "./clip-metadata.ts";

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

export type PipelineOptions = { faceTracking?: boolean; language?: string; mode?: ModeName; facecamRect?: FacecamRect; reselect?: boolean; signal?: AbortSignal };

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Job cancelled");
}

export async function runPipeline(
  videoPath: string,
  jobDir: string,
  force = false,
  reportProgress: PipelineProgress = () => {},
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const startedAt = performance.now();
  await checkFfmpeg();
  const candidatesPath = path.join(jobDir, "candidates.json");
  const needsSelection = force || options.reselect === true || !(await Bun.file(candidatesPath).exists());
  let llm = needsSelection ? new RouterClient(process.env, options.signal) : undefined;
  const metadata = await readJobMetadata(jobDir);
  const mode = resolveJobMode(options.mode, metadata.mode);
  await saveJobMetadata(jobDir, { ...metadata, mode });

  const timedStage = async <T>(stageName: PipelineStage, work: () => Promise<T>): Promise<T> => {
    throwIfAborted(options.signal);
    const start = performance.now();
    reportProgress(stageName, 0);
    const result = await work();
    throwIfAborted(options.signal);
    reportProgress(stageName, 100);
    console.log(`${stageName}: ${((performance.now() - start) / 1000).toFixed(2)}s`);
    return result;
  };

  const wavPath = path.join(jobDir, "audio", "audio.wav");
  await timedStage("audio_extraction", async () => {
    if (force || !(await Bun.file(wavPath).exists())) {
      await extractAudio(videoPath, wavPath, options.signal);
    } else {
      console.log(`Using cached audio: ${wavPath}`);
    }
  });

  const rawTranscript: Transcript = await timedStage("transcription", () =>
    transcribe(wavPath, jobDir, force, options.language, options.signal),
  );
  const transcript: Transcript = {
    ...rawTranscript,
    words: await applyModeGlossary(rawTranscript.words, mode),
  };
  if (!transcript.words.length) {
    throw new Error("No speech was detected in the video. Check that it contains clear spoken audio and try again.");
  }
  if (transcript.words !== rawTranscript.words) {
    await Bun.write(path.join(jobDir, "transcript.json"), JSON.stringify(transcript, null, 2));
  }

  const profile = getMode(mode);
  const candidates: ClipCandidate[] = await timedStage("selection", async () => {
    if (!force && !options.reselect && (await Bun.file(candidatesPath).exists())) {
      console.log(`Using cached candidates: ${candidatesPath}`);
      return (await Bun.file(candidatesPath).json()) as ClipCandidate[];
    }
    const energy = profile.audioWeight > 0
      ? await loadOrComputeAudioEnergy(wavPath, path.join(jobDir, "audio_energy.json"), transcriptSentences(transcript), options.signal)
      : [];
    const selected = await selectCandidates(
      transcript,
      llm ??= new RouterClient(process.env, options.signal),
      new Map(energy.map((item) => [item.sentenceId, item.score])),
      profile.audioWeight,
    );
    await Bun.write(candidatesPath, JSON.stringify(selected, null, 2));
    return selected;
  });

  const metadataById = new Map<string, ClipMetadata>();
  const metadataPath = path.join(jobDir, "clips.json");
  if (!force && await Bun.file(metadataPath).exists()) {
    const previous = await Bun.file(metadataPath).json() as ClipsManifest;
    for (const clip of previous.clips) if (clip.metadata) metadataById.set(clip.id, clip.metadata);
  }
  const identifiedCandidates = candidates.map((candidate, index) => ({
    ...candidate,
    id: candidate.id ?? `clip-${String(index + 1).padStart(2, "0")}`,
  }));
  const missingMetadata = identifiedCandidates.filter((candidate) => !metadataById.has(candidate.id!));
  if (missingMetadata.length) {
    const generated = await generateClipMetadata(transcript, missingMetadata, llm ??= new RouterClient(process.env, options.signal));
    for (const [id, metadata] of generated) metadataById.set(id, metadata);
  }

  const renderedManifest = await timedStage("rendering", () =>
    renderClips(videoPath, jobDir, transcript, identifiedCandidates, force, {}, options.faceTracking === true, profile.layout, options.facecamRect ?? profile.facecamRect, profile.captionPreset, options.signal),
  );
  const manifest: ClipsManifest = {
    ...renderedManifest,
    mode,
    clips: renderedManifest.clips.map((clip) => ({ ...clip, ...(metadataById.has(clip.id) ? { metadata: metadataById.get(clip.id)! } : {}) })),
  };
  await Bun.write(path.join(jobDir, "clips.json"), JSON.stringify(manifest, null, 2));
  console.log(`Total: ${((performance.now() - startedAt) / 1000).toFixed(2)}s`);
  return { manifest, transcriptWords: transcript.words.length, candidateCount: candidates.length };
}
