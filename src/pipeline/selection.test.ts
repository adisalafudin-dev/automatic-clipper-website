import { expect, test } from "bun:test";
import { chunkSentences } from "./chunks.ts";
import { parseCandidateResponse, rankAndMapCandidates } from "./candidates.ts";
import { selectCandidates } from "./select.ts";
import type { Transcript } from "../types.ts";
import { splitSentences, type Sentence } from "./sentences.ts";

const sentences: Sentence[] = Array.from({ length: 10 }, (_, id) => ({
  id,
  text: `Sentence ${id} explains a useful idea.`,
  start: id * 40_000,
  end: (id + 1) * 40_000,
}));

const transcript: Transcript = {
  model: "fixture",
  language: "en",
  words: sentences.flatMap((sentence) => [{
    text: sentence.text,
    start: sentence.start,
    end: sentence.end,
  }]),
};

const proposal = (id: number, score = 8) => ({
  startSentenceId: id,
  endSentenceId: id,
  hook: `Hook ${id}`,
  title: `Title ${id}`,
  score,
  reason: "Complete thought with a clear payoff.",
});

test("chunks at sentence boundaries with repeatable overlap", () => {
  const input = Array.from({ length: 8 }, (_, id) => ({
    id,
    text: "x".repeat(32),
    start: id,
    end: id + 1,
  }));
  const chunks = chunkSentences(input, 20, 8);
  expect(chunks.map((chunk) => chunk.sentences.map((s) => s.id))).toEqual([
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7],
  ]);
});

test("assigns stable sentence IDs and maps each sentence to word times", () => {
  const split = splitSentences([
    { text: "First", start: 100, end: 300 },
    { text: "sentence.", start: 300, end: 700 },
    { text: "Second", start: 900, end: 1100 },
    { text: "one!", start: 1100, end: 1400 },
  ]);
  expect(split).toEqual([
    { id: 0, text: "First sentence.", start: 100, end: 700 },
    { id: 1, text: "Second one!", start: 900, end: 1400 },
  ]);
});

test("validates candidate JSON fields and rejects schema failures", () => {
  expect(parseCandidateResponse({ candidates: [proposal(1)] }).candidates).toHaveLength(1);
  expect(() => parseCandidateResponse({ candidates: [{ ...proposal(1), score: 11 }] })).toThrow();
  expect(() => parseCandidateResponse({ items: [] })).toThrow();
});

test("maps sentence IDs, enforces duration, ranks, and removes overlap", () => {
  const selected = rankAndMapCandidates([
    proposal(0, 6),
    proposal(1, 10),
    proposal(2, 9),
    { ...proposal(3, 10), endSentenceId: 20 },
  ], sentences);
  expect(selected.map((candidate) => candidate.startSentenceId)).toEqual([0, 1, 2]);
  expect(selected[0]!.start).toBe(0);
  expect(selected[0]!.end).toBe(40_000);
  expect(selected.every((candidate) => candidate.end - candidate.start >= 30_000)).toBe(true);
  expect(selected[0]!.end).toBe(selected[1]!.start);
});

test("prefers a larger compatible set over one higher-scored long overlap", () => {
  const timeline = [
    { id: 0, text: "long", start: 0, end: 60_000 },
    { id: 1, text: "left", start: 0, end: 30_000 },
    { id: 2, text: "right", start: 30_000, end: 60_000 },
  ];
  const selected = rankAndMapCandidates([
    { ...proposal(0, 10), endSentenceId: 0 },
    proposal(1, 8),
    proposal(2, 8),
  ], timeline, 30_000, 90_000);
  expect(selected.map((candidate) => candidate.startSentenceId)).toEqual([1, 2]);
});

test("selects valid proposals through the JSON generator interface", async () => {
  let calls = 0;
  let capturedPrompt = "";
  const selected = await selectCandidates(transcript, {
    async generateJson(prompt) {
      calls++;
      capturedPrompt = prompt;
      return { candidates: sentences.map((sentence) => proposal(sentence.id)) };
    },
  });
  expect(calls).toBe(1);
  expect(selected).toHaveLength(10);
  expect(selected.every((candidate) => candidate.start >= 0 && candidate.end <= 400_000)).toBe(true);
  expect(capturedPrompt).toContain("fact-grounded");
  expect(capturedPrompt).toContain("private third-party crisis");
});

test("asks once for more options when a long chunk is underfilled", async () => {
  let calls = 0;
  const selected = await selectCandidates(transcript, {
    async generateJson() {
      calls++;
      return { candidates: sentences.slice(0, calls === 1 ? 4 : 7).map((sentence) => proposal(sentence.id)) };
    },
  });
  expect(calls).toBe(2);
  expect(selected).toHaveLength(7);
});

test("retries invalid JSON once, then skips the chunk", async () => {
  let calls = 0;
  const oldWarn = console.warn;
  console.warn = () => {};
  try {
    const selected = await selectCandidates(transcript, {
      async generateJson() {
        calls++;
        throw new SyntaxError("invalid JSON");
      },
    });
    expect(calls).toBe(2);
    expect(selected).toEqual([]);
  } finally {
    console.warn = oldWarn;
  }
});

test("retries schema errors and out-of-range sentence IDs", async () => {
  for (const value of [
    { candidates: [{ ...proposal(0), title: 3 }] },
    { candidates: [proposal(30)] },
  ]) {
    let calls = 0;
    const oldWarn = console.warn;
    console.warn = () => {};
    try {
      const selected = await selectCandidates(transcript, {
        async generateJson() {
          calls++;
          return value;
        },
      });
      expect(calls).toBe(2);
      expect(selected).toEqual([]);
    } finally {
      console.warn = oldWarn;
    }
  }
});
