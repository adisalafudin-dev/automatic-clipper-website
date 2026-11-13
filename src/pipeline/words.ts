import type { Word, WhisperSegment } from "../types.ts";

// Markers like [_BEG_] or [_TT_200] are not speech. "[MUSIC]" does not match
// because Whisper emits it as normal tokens: " [", "MUSIC", "]".
const SPECIAL_TOKEN = /^\[_.*\]$/;

// Groups Whisper tokens into words. A token starting with a space begins a new
// word; any other token (like "'re" or ",") is glued to the current word.
export function wordsFromSegments(segments: WhisperSegment[], remapVadTimestamps = false): Word[] {
  const words: Word[] = [];

  for (const segment of segments) {
    // A new segment always starts a new word.
    let current: Word | null = null;

    if (!Array.isArray(segment?.tokens)) continue;
    let vadOffset = 0;
    if (remapVadTimestamps) {
      const originalStart = segment.offsets?.from;
      const compactedStart = segment.tokens[0]?.offsets?.from;
      if (typeof originalStart !== "number" || !Number.isFinite(originalStart) ||
          typeof compactedStart !== "number" || !Number.isFinite(compactedStart)) continue;
      vadOffset = originalStart - compactedStart;
    }
    for (const token of segment.tokens) {
      if (typeof token?.text !== "string" || !token.text.trim()) continue;
      if (SPECIAL_TOKEN.test(token.text)) continue;
      const { from: compactedFrom, to: compactedTo } = token.offsets ?? {};
      const from = compactedFrom + vadOffset;
      const to = compactedTo + vadOffset;
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) continue;

      if (current === null || token.text.startsWith(" ")) {
        if (current) words.push(current);
        current = {
          text: token.text.trim(),
          start: from,
          end: to,
        };
      } else {
        if (to < current.end) continue;
        current.text += token.text;
        current.end = to;
      }
    }

    if (current) words.push(current);
  }

  // Drop anything that ended up empty (for example a whitespace-only token).
  return words.filter((w) => w.text.length > 0 && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
}
