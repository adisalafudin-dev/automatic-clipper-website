import { expect, test } from "bun:test";
import { combineScores, normalizeSentenceEnergy, parseAudioFrameLevels } from "./audio-energy.ts";

test("parses timestamped RMS metadata from FFmpeg", () => {
  expect(parseAudioFrameLevels("frame:0 pts:0 pts_time:0\nlavfi.astats.Overall.RMS_level=-30.0\nframe:1 pts:1024 pts_time:0.1\nlavfi.astats.Overall.RMS_level=-10.0")).toEqual([
    { time: 0, rmsDb: -30 }, { time: 0.1, rmsDb: -10 },
  ]);
});

test("normalizes sentence-window loudness to a percentile-bounded 0-10 score", () => {
  expect(normalizeSentenceEnergy([
    { id: 0, text: "quiet", start: 0, end: 1000 },
    { id: 1, text: "loud", start: 1000, end: 2000 },
  ], [
    { time: 0.2, rmsDb: -30 }, { time: 1.2, rmsDb: -10 },
  ])).toEqual([{ sentenceId: 0, score: 0 }, { sentenceId: 1, score: 10 }]);
});

test("combines LLM and energy scores while zero weight preserves LLM ranking", () => {
  expect(combineScores(7, 2, 0)).toBe(7);
  expect(combineScores(7, 2, 0.3)).toBeCloseTo(5.5);
});
