import type { Sentence } from "./sentences.ts";

export type Chunk = {
  index: number;
  sentences: Sentence[];
  estimatedTokens: number;
};

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function chunkSentences(
  sentences: Sentence[],
  maxTokens = 6000,
  overlapTokens = 400,
): Chunk[] {
  if (maxTokens < 1 || overlapTokens < 0 || overlapTokens >= maxTokens) {
    throw new Error("Chunk limits must satisfy maxTokens > overlapTokens >= 0");
  }

  const chunks: Chunk[] = [];
  let start = 0;
  while (start < sentences.length) {
    let end = start;
    let tokens = 0;
    while (end < sentences.length) {
      const next = estimateTokens(sentences[end]!.text);
      if (end > start && tokens + next > maxTokens) break;
      tokens += next;
      end++;
      if (tokens >= maxTokens) break;
    }

    const items = sentences.slice(start, end);
    chunks.push({ index: chunks.length, sentences: items, estimatedTokens: tokens });
    if (end === sentences.length) break;

    let overlap = 0;
    let nextStart = end;
    while (nextStart > start + 1) {
      const previous = estimateTokens(sentences[nextStart - 1]!.text);
      if (overlap + previous > overlapTokens) break;
      overlap += previous;
      nextStart--;
    }
    start = nextStart;
  }
  return chunks;
}
