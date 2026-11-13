import { expect, test } from "bun:test";
import { parseCliArgs } from "./cli-options.ts";

test("uses default mode when no mode flag is provided", () => {
  expect(parseCliArgs(["video.mp4"])).toEqual({
    videoPath: "video.mp4", force: false, faceTracking: false, mode: undefined, facecamRect: undefined,
  });
});

test("parses mode with existing CLI flags in either order", () => {
  expect(parseCliArgs(["--mode", "gaming", "--force", "video.mp4", "--face-track"])).toEqual({
    videoPath: "video.mp4", force: true, faceTracking: true, mode: "gaming", facecamRect: undefined,
  });
});

test("parses and validates a facecam rectangle override", () => {
  expect(parseCliArgs(["video.mp4", "--facecam-rect", "0.6,0.1,0.3,0.25"]).facecamRect).toEqual({ x: 0.6, y: 0.1, w: 0.3, h: 0.25 });
  expect(() => parseCliArgs(["video.mp4", "--facecam-rect", "1,0,1,1"])).toThrow("fit within the normalized frame");
});

test("rejects unknown, missing, and invalid mode arguments with valid choices", () => {
  expect(() => parseCliArgs(["video.mp4", "--mode", "missing"])).toThrow("Valid modes: default, gaming, podcast");
  expect(() => parseCliArgs(["video.mp4", "--mode"])).toThrow("Valid modes: default, gaming, podcast");
  expect(() => parseCliArgs(["video.mp4", "--mode", "toString"])).toThrow("Valid modes: default, gaming, podcast");
});
