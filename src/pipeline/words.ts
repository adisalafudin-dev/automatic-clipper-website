import type { Word, WhisperSegment } from "../types.ts";

// Markers like [_BEG_] or [_TT_200] are not speech. "[MUSIC]" does not match
// because Whisper emits it as normal tokens: " [", "MUSIC", "]".
const SPECIAL_TOKEN = /^\[_.*\]$/;

// Groups Whisper tokens into words. A token starting with a space begins a new
// word; any other token (like "'re" or ",") is glued to the current word.
export function wordsFromSegments(segments: WhisperSegment[]): Word[] {
  const words: Word[] = [];

  for (const segment of segments) {
    // A new segment always starts a new word.
    let current: Word | null = null;

    for (const token of segment.tokens) {
      if (SPECIAL_TOKEN.test(token.text)) continue;

      if (current === null || token.text.startsWith(" ")) {
        if (current) words.push(current);
        current = {
          text: token.text.trim(),
          start: token.offsets.from,
          end: token.offsets.to,
        };
      } else {
        current.text += token.text;
        current.end = token.offsets.to;
      }
    }

    if (current) words.push(current);
  }

  // Drop anything that ended up empty (for example a whitespace-only token).
  return words.filter((w) => w.text.length > 0);
}
