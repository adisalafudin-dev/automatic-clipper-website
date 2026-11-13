import { expect, test } from "bun:test";
import { generateClipMetadata, validateClipMetadata } from "./clip-metadata.ts";
import type { Transcript } from "../types.ts";
import type { ClipCandidate } from "./candidates.ts";
import type { JsonGenerator } from "./llm.ts";

const transcript: Transcript = {
  model: "fixture", language: "en", words: [
    { text: "Clip-only", start: 1000, end: 1500 },
    { text: "text.", start: 1500, end: 2000 },
    { text: "private", start: 5000, end: 5500 },
  ],
};
const candidates: ClipCandidate[] = [{
  id: "clip-01", start: 1000, end: 2000, startSentenceId: 0, endSentenceId: 0,
  hook: "hook", title: "title", score: 8, reason: "reason",
}];

test("validates the metadata schema and trims fields", () => {
  expect(validateClipMetadata({ title: " Title ", description: " Description ", hashtags: [" tag "] })).toEqual({
    title: "Title", description: "Description", hashtags: ["tag"],
  });
  expect(() => validateClipMetadata({ title: "", description: "x", hashtags: [] })).toThrow("title");
  expect(() => validateClipMetadata({ title: "x", description: "y", hashtags: [1] })).toThrow("hashtags");
});

test("generates metadata sequentially from only the clip transcript", async () => {
  const prompts: string[] = [];
  const fake: JsonGenerator = { generateJson: async (prompt) => {
    prompts.push(prompt);
    return { title: "Judul", description: "Deskripsi", hashtags: ["video"] };
  } };
  const result = await generateClipMetadata(transcript, candidates, fake);
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("Clip-only text.");
  expect(prompts[0]).toContain("Bahasa Indonesia");
  expect(prompts[0]).not.toContain("private");
  expect(result.get("clip-01")?.hashtags).toEqual(["video"]);
});

test("retries invalid JSON/schema once then skips that clip", async () => {
  let calls = 0;
  const retryFake: JsonGenerator = { generateJson: async () => {
    calls++;
    if (calls === 1) return { title: "bad" };
    return { title: "Judul", description: "Deskripsi", hashtags: [] };
  } };
  expect((await generateClipMetadata(transcript, candidates, retryFake)).has("clip-01")).toBe(true);
  expect(calls).toBe(2);

  let invalidCalls = 0;
  const invalidFake: JsonGenerator = { generateJson: async () => { invalidCalls++; return "not-json"; } };
  expect((await generateClipMetadata(transcript, candidates, invalidFake)).size).toBe(0);
  expect(invalidCalls).toBe(2);
});
