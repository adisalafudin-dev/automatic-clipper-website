import { expect, test } from "bun:test";
import { parseCliArgs } from "./cli-options.ts";

test("uses default mode when no mode flag is provided", () => {
  expect(parseCliArgs(["video.mp4"])).toEqual({
    videoPath: "video.mp4", force: false, faceTracking: false, mode: undefined,
  });
});

test("parses mode with existing CLI flags in either order", () => {
  expect(parseCliArgs(["--mode", "gaming", "--force", "video.mp4", "--face-track"])).toEqual({
    videoPath: "video.mp4", force: true, faceTracking: true, mode: "gaming",
  });
});

test("rejects unknown, missing, and invalid mode arguments with valid choices", () => {
  expect(() => parseCliArgs(["video.mp4", "--mode", "missing"])).toThrow("Valid modes: default, gaming, podcast");
  expect(() => parseCliArgs(["video.mp4", "--mode"])).toThrow("Valid modes: default, gaming, podcast");
  expect(() => parseCliArgs(["video.mp4", "--mode", "toString"])).toThrow("Valid modes: default, gaming, podcast");
});
