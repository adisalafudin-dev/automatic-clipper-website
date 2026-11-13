import { expect, test } from "bun:test";
import { applyGlossary } from "./glossary.ts";
import type { Word } from "../types.ts";

const words: Word[] = [
  { text: "Wkwk,", start: 100, end: 250 },
  { text: "gak", start: 300, end: 400 },
  { text: "apa?", start: 420, end: 550 },
  { text: "GG", start: 700, end: 850 },
];

test("replaces a case-insensitive whole word and preserves punctuation and timing", () => {
  expect(applyGlossary(words, { wkwk: "tertawa" })[0]).toEqual({ text: "tertawa,", start: 100, end: 250 });
});

test("maps a multi-word phrase onto its original time span", () => {
  expect(applyGlossary(words, { "gak apa": "tidak masalah" }).slice(1, 3)).toEqual([
    { text: "tidak", start: 300, end: 404 },
    { text: "masalah?", start: 404, end: 550 },
  ]);
});

test("does not replace partial-word matches or unmatched terms", () => {
  expect(applyGlossary(words, { gak: "tidak" })[3]).toEqual(words[3]);
  expect(applyGlossary(words, { kw: "tertawa" })[0]).toEqual(words[0]);
});

test("an empty glossary leaves the transcript unchanged", () => {
  expect(applyGlossary(words, {})).toEqual(words);
});
