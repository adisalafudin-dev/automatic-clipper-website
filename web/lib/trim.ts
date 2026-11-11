import type { UiWord } from "../../src/types.ts";
import type { UiSentence } from "../../src/types.ts";

export type TimeRange = { startMs: number; endMs: number };

export function sentenceSelectionRange(sentences: UiSentence[], selectedIds: number[]): TimeRange | null {
  if (!selectedIds.length) return null;
  const selected = sentences.filter((sentence) => selectedIds.includes(sentence.id));
  if (!selected.length) return null;
  return { startMs: Math.min(...selected.map((sentence) => sentence.start)), endMs: Math.max(...selected.map((sentence) => sentence.end)) };
}

export function clampRange(range: TimeRange, durationMs: number): TimeRange {
  const duration = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
  let startMs = Math.min(duration, Math.max(0, Number.isFinite(range.startMs) ? range.startMs : 0));
  let endMs = Math.min(duration, Math.max(0, Number.isFinite(range.endMs) ? range.endMs : 0));
  if (endMs <= startMs && duration > 0) startMs = Math.max(0, endMs - 1);
  return { startMs, endMs };
}

export function snapRangeToWords(range: TimeRange, words: UiWord[], durationMs: number): TimeRange {
  if (!words.length) return clampRange(range, durationMs);
  const starts = words.map((word) => word.start);
  const ends = words.map((word) => word.end);
  const nearestTime = (time: number, values: number[]) => values.reduce((best, value) => Math.abs(value - time) < Math.abs(best - time) ? value : best, values[0]!);
  return clampRange({ startMs: nearestTime(range.startMs, starts), endMs: nearestTime(range.endMs, ends) }, durationMs);
}

export function durationWarning(range: TimeRange): "too-short" | "too-long" | null {
  const duration = range.endMs - range.startMs;
  if (duration < 30_000) return "too-short";
  if (duration > 90_000) return "too-long";
  return null;
}

export function formatTime(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const millis = safeMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function parseTime(value: string): number | null {
  const match = /^(\d+):(\d{2})(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[2]);
  if (seconds > 59) return null;
  const millis = Number((match[3] ?? "").padEnd(3, "0"));
  return Number(match[1]) * 60_000 + seconds * 1000 + millis;
}
