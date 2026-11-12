import { expect, test } from "bun:test";
import { configuredClipLanguage, isClipLanguage } from "./languages.ts";

test("accepts supported English and Indonesian clip languages", () => {
  expect(isClipLanguage("en")).toBe(true);
  expect(isClipLanguage("id")).toBe(true);
  expect(isClipLanguage("fr")).toBe(false);
  expect(isClipLanguage(null)).toBe(false);
});

test("uses Indonesian only when configured, otherwise defaults to English", () => {
  expect(configuredClipLanguage("id")).toBe("id");
  expect(configuredClipLanguage("en")).toBe("en");
  expect(configuredClipLanguage(undefined)).toBe("en");
});
