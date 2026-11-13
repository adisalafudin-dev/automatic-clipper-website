import { expect, test } from "bun:test";
import { defaultProjectName, normalizeProjectName } from "./project-name.ts";

test("project name defaults to filename stem across path styles", () => {
  expect(defaultProjectName("C:\\Videos\\Podcast episode.mp4")).toBe("Podcast episode");
  expect(defaultProjectName("/videos/no-extension")).toBe("no-extension");
  expect(defaultProjectName(".mp4")).toBe("Untitled video");
});

test("project names are trimmed and validated", () => {
  expect(normalizeProjectName("  My episode  ")).toBe("My episode");
  expect(() => normalizeProjectName("  ")).toThrow("cannot be empty");
  expect(() => normalizeProjectName("x".repeat(101))).toThrow("100 characters or fewer");
});
