import { readFile } from "node:fs/promises";
import type { Sentence } from "./sentences.ts";

export type AudioFrameLevel = { time: number; rmsDb: number };
export type SentenceEnergy = { sentenceId: number; score: number };

export function parseAudioFrameLevels(stderr: string): AudioFrameLevel[] {
  const frames: AudioFrameLevel[] = [];
  let time: number | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    const timestamp = /^frame:\d+\s+pts:\S+\s+pts_time:([\d.]+)/.exec(line);
    if (timestamp) time = Number(timestamp[1]);
    const level = /^lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+)$/.exec(line);
    if (level && time !== undefined) {
      const rmsDb = Number(level[1]);
      if (Number.isFinite(rmsDb)) frames.push({ time, rmsDb });
      time = undefined;
    }
  }
  return frames;
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

export function normalizeSentenceEnergy(sentences: Sentence[], frames: AudioFrameLevel[]): SentenceEnergy[] {
  const raw = sentences.map((sentence) => {
    const levels = frames.filter((frame) => frame.time * 1000 >= sentence.start && frame.time * 1000 < sentence.end).map((frame) => frame.rmsDb);
    return { sentenceId: sentence.id, rmsDb: levels.length ? levels.reduce((sum, level) => sum + level, 0) / levels.length : -120 };
  });
  if (!raw.length) return [];
  const low = percentile(raw.map((item) => item.rmsDb), 0.1);
  const high = percentile(raw.map((item) => item.rmsDb), 0.9);
  return raw.map((item) => ({
    sentenceId: item.sentenceId,
    score: high <= low ? 0 : Math.max(0, Math.min(10, ((item.rmsDb - low) / (high - low)) * 10)),
  }));
}

export function combineScores(llmScore: number, energyScore: number, weight: number): number {
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error("Audio weight must be between 0 and 1");
  return (1 - weight) * llmScore + weight * energyScore;
}

export async function loadOrComputeAudioEnergy(
  wavPath: string,
  cachePath: string,
  sentences: Sentence[],
  signal?: AbortSignal,
): Promise<SentenceEnergy[]> {
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as SentenceEnergy[];
    if (cached.length === sentences.length && cached.every((item, index) => item.sentenceId === sentences[index]!.id)) return cached;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  // FFmpeg emits per-frame RMS levels as metadata; timestamps are mapped to sentence windows below.
  const proc = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", wavPath,
    "-af", "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
    "-f", "null", "-",
  ], { stdout: "ignore", stderr: "pipe", signal });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`FFmpeg audio energy analysis failed (exit code ${code}): ${stderr.trim()}`);
  const energy = normalizeSentenceEnergy(sentences, parseAudioFrameLevels(stderr));
  await Bun.write(cachePath, JSON.stringify(energy, null, 2));
  return energy;
}
