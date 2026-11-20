import { expect, test } from "bun:test";
import { inferFacecamRect, smoothFaceCenters } from "./faces.ts";

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

test("infers a stable facecam rectangle from repeated face detections", () => {
  const samples = [
    { time: 0, centerX: 180, centerY: 800, width: 100, height: 120, score: 0.9 },
    { time: 5, centerX: 185, centerY: 810, width: 104, height: 124, score: 0.95 },
    { time: 10, centerX: 178, centerY: 805, width: 98, height: 122, score: 0.92 },
    { time: 15, centerX: 1500, centerY: 350, width: 180, height: 160, score: 0.99 },
  ];
  const rect = inferFacecamRect(samples, { width: 1920, height: 1080 });
  expect(rect).not.toBeNull();
  expect(rect!.x).toBe(0);
  expect(rect!.y).toBeCloseTo(0.604);
  expect(rect!.w).toBeCloseTo(0.26);
  expect(rect!.h).toBeCloseTo(0.282);
});

test("declines automatic placement without repeated stable detections", () => {
  expect(inferFacecamRect([
    { time: 0, centerX: 200, centerY: 500, width: 90, height: 110, score: 0.9 },
    { time: 5, centerX: 1300, centerY: 500, width: 90, height: 110, score: 0.9 },
  ], { width: 1920, height: 1080 })).toBeNull();
});
