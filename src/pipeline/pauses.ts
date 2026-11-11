import type { Word } from "../types.ts";

// Gaps longer than this are dead air. Each side of a cut keeps a short breath
// so the join does not land on the edge of a word.
export const PAUSE_GAP_MS = 600;
export const PAUSE_PAD_MS = 120;
const MIN_SPAN_MS = 40;

export type SourceSpan = { start: number; end: number };

export function keepSpans(
  words: Word[],
  clipStart: number,
  clipEnd: number,
  gapMs = PAUSE_GAP_MS,
  padMs = PAUSE_PAD_MS,
): SourceSpan[] {
  if (!(clipEnd > clipStart)) return [];
  const spoken = words
    .filter((word) => word.end > clipStart && word.start < clipEnd && word.end > word.start)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!spoken.length) return [{ start: clipStart, end: clipEnd }];

  const spans: SourceSpan[] = [];
  let start = Math.max(clipStart, spoken[0]!.start - padMs);
  let coveredUntil = Math.min(clipEnd, spoken[0]!.end);

  const close = (wordEnd: number) => {
    const end = Math.min(clipEnd, wordEnd + padMs);
    if (end - start >= MIN_SPAN_MS) spans.push({ start, end });
  };

  for (let index = 1; index < spoken.length; index++) {
    const word = spoken[index]!;
    const wordStart = Math.max(clipStart, word.start);
    if (wordStart - coveredUntil > gapMs) {
      close(coveredUntil);
      start = Math.max(clipStart, wordStart - padMs);
      coveredUntil = Math.min(clipEnd, word.end);
    } else {
      coveredUntil = Math.max(coveredUntil, Math.min(clipEnd, word.end));
    }
  }
  close(coveredUntil);
  return spans.length ? spans : [{ start: clipStart, end: clipEnd }];
}

export function spanDuration(spans: SourceSpan[]): number {
  return spans.reduce((total, span) => total + (span.end - span.start), 0);
}

// Source time mapped onto the concatenated keep spans. Null when it falls in a cut.
export function outputOffsetMs(sourceMs: number, spans: SourceSpan[]): number | null {
  let cursor = 0;
  for (const span of spans) {
    const length = span.end - span.start;
    if (sourceMs < span.start) return null;
    if (sourceMs <= span.end) return cursor + (sourceMs - span.start);
    cursor += length;
  }
  return null;
}

export function wordsOnOutputTimeline(words: Word[], spans: SourceSpan[]): Word[] {
  const shifted: Word[] = [];
  for (const word of words) {
    for (const span of spans) {
      const start = Math.max(word.start, span.start);
      const end = Math.min(word.end, span.end);
      if (end <= start) continue;
      const origin = outputOffsetMs(span.start, spans);
      if (origin === null) continue;
      shifted.push({
        text: word.text,
        start: origin + (start - span.start),
        end: origin + (end - span.start),
      });
      break;
    }
  }
  return shifted;
}
