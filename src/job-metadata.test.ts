import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readJobMetadata, resolveJobMode, saveJobMetadata } from "./job-metadata.ts";

test("defaults to default, reuses a saved mode, and honors an explicit override", () => {
  expect(resolveJobMode(undefined, undefined)).toBe("default");
  expect(resolveJobMode(undefined, "gaming")).toBe("gaming");
  expect(resolveJobMode("podcast", "gaming")).toBe("podcast");
});

test("rejects invalid saved modes unless an explicit mode replaces them", () => {
  expect(() => resolveJobMode(undefined, "toString")).toThrow("Valid modes: default, gaming, podcast");
  expect(() => resolveJobMode(undefined, 4)).toThrow("Saved job mode must be a string");
  expect(resolveJobMode("default", "toString")).toBe("default");
});

test("stores mode in job.json without removing other job metadata", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "clipper-job-metadata-"));
  try {
    await saveJobMetadata(temp, { id: "fixture", mode: "gaming" });
    expect(await readJobMetadata(temp)).toEqual({ id: "fixture", mode: "gaming" });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
