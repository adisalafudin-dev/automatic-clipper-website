import { expect, test } from "bun:test";
import { keepSpans, outputOffsetMs, spanDuration, wordsOnOutputTimeline } from "./pauses.ts";

test("cuts inter-word gaps over 600 ms and keeps a 120 ms breath on each side", () => {
  const spans = keepSpans([
    { text: "Wait", start: 0, end: 400 },
    { text: "now.", start: 1800, end: 2200 },
  ], 0, 3000);
  expect(spans).toEqual([
    { start: 0, end: 520 },
    { start: 1680, end: 2320 },
  ]);
  expect(spanDuration(spans)).toBe(1160);
});

test("keeps short breaths and trims leading and trailing silence to the pad", () => {
  const spans = keepSpans([
    { text: "Hello", start: 800, end: 1200 },
    { text: "there.", start: 1400, end: 1800 },
  ], 0, 4000);
  expect(spans).toEqual([{ start: 680, end: 1920 }]);
});

test("returns the full range when the clip has no words", () => {
  expect(keepSpans([], 1000, 2000)).toEqual([{ start: 1000, end: 2000 }]);
});

test("moves caption words onto the concatenated timeline", () => {
  const spans = keepSpans([
    { text: "Wait", start: 0, end: 400 },
    { text: "now.", start: 1800, end: 2200 },
  ], 0, 3000);
  expect(wordsOnOutputTimeline([
    { text: "Wait", start: 0, end: 400 },
    { text: "now.", start: 1800, end: 2200 },
  ], spans)).toEqual([
    { text: "Wait", start: 0, end: 400 },
    { text: "now.", start: 640, end: 1040 },
  ]);
  expect(outputOffsetMs(900, spans)).toBeNull();
  expect(outputOffsetMs(1800, spans)).toBe(640);
});
