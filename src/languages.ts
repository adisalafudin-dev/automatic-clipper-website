import type { ClipLanguage } from "./types.ts";

export function isClipLanguage(value: unknown): value is ClipLanguage {
  return value === "auto" || value === "en" || value === "id";
}

export function configuredClipLanguage(value: string | undefined): ClipLanguage {
  return value === "en" || value === "id" ? value : "auto";
}
