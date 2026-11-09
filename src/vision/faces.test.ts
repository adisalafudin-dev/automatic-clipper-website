import { expect, test } from "bun:test";
import { smoothFaceCenters } from "./faces.ts";

test("face crop path suppresses a one-sample jump while following gradual movement", () => {
  const smoothed = smoothFaceCenters([
    { time: 0, centerX: 100 },
    { time: 5, centerX: 500 },
    { time: 10, centerX: 140 },
    { time: 15, centerX: 190 },
  ]);
  expect(smoothed[1]!.centerX).toBe(107);
  expect(smoothed[2]!.centerX).toBeCloseTo(118.55);
  expect(smoothed[3]!.centerX).toBeCloseTo(143.56);
});

test("empty face detections leave the renderer on center crop", () => {
  expect(smoothFaceCenters([])).toEqual([]);
});
