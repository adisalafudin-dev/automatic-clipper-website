import { expect, test } from "bun:test";
import { clampRange, durationWarning, formatTime, parseTime, sentenceSelectionRange, snapRangeToWords } from "./trim.ts";

test("clamps trim endpoints to the source duration and preserves a positive interval", () => {
  expect(clampRange({ startMs: -100, endMs: 40_000 }, 31_000)).toEqual({ startMs: 0, endMs: 31_000 });
  expect(clampRange({ startMs: 20_000, endMs: 10_000 }, 31_000)).toEqual({ startMs: 9_999, endMs: 10_000 });
});

test("snaps start and end to the nearest word boundaries", () => {
  expect(snapRangeToWords({ startMs: 145, endMs: 345 }, [
    { text: "one", start: 100, end: 200 }, { text: "two", start: 250, end: 400 },
  ], 1000)).toEqual({ startMs: 100, endMs: 400 });
});

test("formats and parses mm:ss.mmm without losing milliseconds", () => {
  expect(formatTime(90_023)).toBe("1:30.023");
  expect(parseTime("1:30.023")).toBe(90_023);
  expect(parseTime("1:75.000")).toBeNull();
});

test("warns outside the preferred clip duration without clamping it", () => {
  expect(durationWarning({ startMs: 0, endMs: 29_999 })).toBe("too-short");
  expect(durationWarning({ startMs: 0, endMs: 90_001 })).toBe("too-long");
  expect(durationWarning({ startMs: 0, endMs: 30_000 })).toBeNull();
});

test("maps selected sentence IDs to the enclosing time range", () => {
  expect(sentenceSelectionRange([
    { id: 1, text: "One", start: 100, end: 200, words: [] },
    { id: 2, text: "Two", start: 250, end: 500, words: [] },
  ], [2, 1])).toEqual({ startMs: 100, endMs: 500 });
  expect(sentenceSelectionRange([], [])).toBeNull();
});
