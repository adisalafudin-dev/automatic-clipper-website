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
