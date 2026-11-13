import type { Transcript } from "../types.ts";
import type { ClipCandidate } from "./candidates.ts";
import type { JsonGenerator } from "./llm.ts";

export type ClipMetadata = { title: string; description: string; hashtags: string[] };
const SCHEMA = `{"title":"string","description":"string","hashtags":["string"]}`;

export function validateClipMetadata(value: unknown): ClipMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Metadata must be a JSON object");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["title", "description", "hashtags"].includes(key))) throw new Error("Metadata contains unexpected fields");
  if (typeof record.title !== "string" || !record.title.trim()) throw new Error("Metadata title must be a non-empty string");
  if (typeof record.description !== "string" || !record.description.trim()) throw new Error("Metadata description must be a non-empty string");
  if (!Array.isArray(record.hashtags) || record.hashtags.some((tag) => typeof tag !== "string" || !tag.trim())) {
    throw new Error("Metadata hashtags must be an array of non-empty strings");
  }
  return { title: record.title.trim(), description: record.description.trim(), hashtags: record.hashtags.map((tag) => (tag as string).trim()) };
}

export async function generateClipMetadata(
  transcript: Transcript,
  candidates: ClipCandidate[],
  llm: JsonGenerator,
): Promise<Map<string, ClipMetadata>> {
  const results = new Map<string, ClipMetadata>();
  for (const [index, candidate] of candidates.entries()) {
    const clipId = candidate.id ?? `clip-${String(index + 1).padStart(2, "0")}`;
    const clipTranscript = transcript.words
      .filter((word) => word.start < candidate.end && word.end > candidate.start)
      .map((word) => word.text)
      .join(" ")
      .trim();
    const prompt = [
      "Create concise social media metadata for this short video clip.",
      `Write the title and description in ${transcript.language.toLowerCase().startsWith("id") ? "natural Bahasa Indonesia" : `the same language as the transcript (${transcript.language})`}. Use only facts from the clip transcript.`,
      "Return a short title, one or two sentence description, and 3-6 relevant hashtags without the # prefix.",
      "The input below contains only this clip's transcript.",
      clipTranscript,
    ].join("\n\n");
    let failure = "invalid response";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        results.set(clipId, validateClipMetadata(await llm.generateJson(prompt, SCHEMA)));
        failure = "";
        break;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    }
    if (failure) console.warn(`Skipping metadata for ${clipId} after retry: ${failure}`);
  }
  return results;
}
