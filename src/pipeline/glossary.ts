import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Word } from "../types.ts";
import type { ModeName } from "../modes.ts";

type GlossaryEntry = { source: string[]; target: string[] };

function coreWord(value: string): { prefix: string; core: string; suffix: string } {
  const match = /^([^\p{L}\p{N}_]*)([\p{L}\p{N}_'-]+)([^\p{L}\p{N}_]*)$/u.exec(value);
  return match ? { prefix: match[1]!, core: match[2]!, suffix: match[3]! } : { prefix: "", core: value, suffix: "" };
}

export function applyGlossary(words: Word[], glossary: Record<string, string>): Word[] {
  const entries: GlossaryEntry[] = Object.entries(glossary)
    .map(([source, target]) => ({ source: source.trim().split(/\s+/).filter(Boolean), target: target.trim().split(/\s+/).filter(Boolean) }))
    .filter((entry) => entry.source.length > 0 && entry.target.length > 0)
    .sort((a, b) => b.source.length - a.source.length);
  const output: Word[] = [];
  for (let index = 0; index < words.length;) {
    const entry = entries.find((candidate) => candidate.source.every((term, offset) =>
      coreWord(words[index + offset]?.text ?? "").core.toLocaleLowerCase() === term.toLocaleLowerCase(),
    ));
    if (!entry) {
      output.push(words[index]!);
      index++;
      continue;
    }
    const matched = words.slice(index, index + entry.source.length);
    const first = coreWord(matched[0]!.text);
    const last = coreWord(matched.at(-1)!.text);
    const start = matched[0]!.start;
    const end = matched.at(-1)!.end;
    const duration = end - start;
    const totalCharacters = entry.target.reduce((sum, token) => sum + token.length, 0);
    let consumed = 0;
    for (const [targetIndex, target] of entry.target.entries()) {
      const before = consumed;
      consumed += target.length;
      const tokenStart = entry.target.length === 1 || duration < entry.target.length
        ? start
        : Math.floor(start + duration * before / totalCharacters);
      const tokenEnd = entry.target.length === 1 || duration < entry.target.length
        ? end
        : targetIndex === entry.target.length - 1
          ? end
          : Math.max(tokenStart + 1, Math.floor(start + duration * consumed / totalCharacters));
      const text = `${targetIndex === 0 ? first.prefix : ""}${target}${targetIndex === entry.target.length - 1 ? last.suffix : ""}`;
      output.push({ text, start: tokenStart, end: tokenEnd });
    }
    index += entry.source.length;
  }
  return output;
}

export async function applyModeGlossary(words: Word[], mode: ModeName, glossaryRoot = "glossaries"): Promise<Word[]> {
  const file = path.join(glossaryRoot, `${mode}.json`);
  try {
    const glossary = JSON.parse(await readFile(file, "utf8")) as Record<string, string>;
    if (!glossary || typeof glossary !== "object" || Array.isArray(glossary) || Object.values(glossary).some((value) => typeof value !== "string")) {
      throw new Error(`Glossary ${file} must contain a JSON object of phrase replacements`);
    }
    return applyGlossary(words, glossary);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return words;
    throw error;
  }
}
