import { test, expect } from "bun:test";
import { wordsFromSegments } from "./words.ts";

// Small helper to build a token.
const tok = (text: string, from: number, to: number) => ({
  text,
  offsets: { from, to },
});

test("glues apostrophes and punctuation to their word", () => {
  const words = wordsFromSegments([
    {
      tokens: [
        tok(" Cuz", 8990, 9010),
        tok(" you", 9630, 9700),
        tok("'re", 9700, 10070),
        tok(" Iron", 10500, 10800),
        tok(" Man", 10800, 11200),
        tok(",", 11200, 11310),
      ],
    },
  ]);
  expect(words).toEqual([
    { text: "Cuz", start: 8990, end: 9010 },
    { text: "you're", start: 9630, end: 10070 },
    { text: "Iron", start: 10500, end: 10800 },
    { text: "Man,", start: 10800, end: 11310 },
  ]);
});

test("drops special tokens like [_BEG_] and [_TT_200]", () => {
  const words = wordsFromSegments([
    {
      tokens: [
        tok("[_BEG_]", 0, 0),
        tok(" Hello", 30, 500),
        tok("[_TT_200]", 4000, 4000),
      ],
    },
  ]);
  expect(words).toEqual([{ text: "Hello", start: 30, end: 500 }]);
});

test("merges [MUSIC], which arrives as three tokens, into one word", () => {
  const words = wordsFromSegments([
    {
      tokens: [
        tok("[_BEG_]", 0, 0),
        tok(" [", 30, 50),
        tok("MUSIC", 1690, 3420),
        tok("]", 3420, 4000),
        tok("[_TT_200]", 4000, 4000),
      ],
    },
  ]);
  expect(words).toEqual([{ text: "[MUSIC]", start: 30, end: 4000 }]);
});

test("a new segment starts a new word even without a leading space", () => {
  const words = wordsFromSegments([
    { tokens: [tok(" end", 100, 200)] },
    { tokens: [tok("start", 300, 400)] },
  ]);
  expect(words).toEqual([
    { text: "end", start: 100, end: 200 },
    { text: "start", start: 300, end: 400 },
  ]);
});

test("drops empty segments, blank tokens, and invalid timestamps without shifting later times", () => {
  const words = wordsFromSegments([
    { tokens: [] },
    { tokens: [tok("   ", 0, 50), tok("broken", Number.NaN, 100), tok("backwards", 100, 90)] },
    { tokens: [tok(" Hello", 1_250, 1_600), tok("!", 1_600, 1_700)] },
  ]);
  expect(words).toEqual([{ text: "Hello!", start: 1_250, end: 1_700 }]);
});

test("ignores malformed tokens and keeps repeated spoken words", () => {
  const words = wordsFromSegments([
    { tokens: [tok(" yes", 100, 200), { text: "bad", offsets: { from: 300, to: 250 } } as never] },
    { tokens: [tok(" yes", 400, 500)] },
  ]);
  expect(words).toEqual([
    { text: "yes", start: 100, end: 200 },
    { text: "yes", start: 400, end: 500 },
  ]);
});

test("maps compacted VAD token offsets back onto the source audio timeline", () => {
  // Captured from whisper.cpp -ojf with Silero VAD: segment JSON timestamps are
  // remapped, but the token offsets remain on the compacted VAD timeline.
  const words = wordsFromSegments([{
    offsets: { from: 69_920, to: 72_230 },
    timestamps: { from: "00:01:09,920", to: "00:01:12,230" },
    tokens: [tok(" Nah", 42_230, 42_570), tok(",", 42_570, 42_800), tok(" oke", 43_380, 43_660)],
  }], true);
  expect(words).toEqual([
    { text: "Nah,", start: 69_920, end: 70_490 },
    { text: "oke", start: 71_070, end: 71_350 },
  ]);
});

test("does not emit VAD words when source mapping metadata is missing", () => {
  expect(wordsFromSegments([{ tokens: [tok(" hello", 100, 200)] }], true)).toEqual([]);
});
