import type { Transcript } from "../types.ts";
import { chunkSentences } from "./chunks.ts";
import { parseCandidateResponse, rankAndMapCandidates, type ClipCandidate } from "./candidates.ts";
import type { JsonGenerator } from "./llm.ts";
import { transcriptSentences } from "./sentences.ts";
import { combineScores } from "./audio-energy.ts";

const SCHEMA = `{"candidates":[{"startSentenceId":0,"endSentenceId":1,"hook":"string","title":"string","score":0,"reason":"string"}]}`;

export async function selectCandidates(
  transcript: Transcript,
  llm: JsonGenerator,
  energyScores: Map<number, number> = new Map(),
  audioWeight = 0,
): Promise<ClipCandidate[]> {
  const sentences = transcriptSentences(transcript);
  const chunks = chunkSentences(sentences);
  const proposals = [];
  const failures: string[] = [];

  if (!sentences.length) {
    throw new Error("No speech was detected in the video. Check that it contains clear spoken audio and try again.");
  }

  for (const chunk of chunks) {
    const source = chunk.sentences
      .map((sentence) => `[${sentence.id}] ${sentence.text}`)
      .join("\n");
    const outputLanguage = transcript.language.toLowerCase().startsWith("id")
      ? "natural Bahasa Indonesia"
      : `the same language as the transcript (${transcript.language})`;
    const prompt = [
      "Find self-contained short video clips with a strong opening, clear payoff, and no missing context.",
      "Return 30–90 second clip candidates. Choose boundaries from the supplied sentence IDs only.",
      "Return 8–10 varied candidate options when the transcript allows, spread across distinct topics and time ranges; include non-overlapping alternatives.",
      "Aim for at least five final non-overlapping clips by offering alternatives across the full chunk, not several versions of one moment.",
      "Exclude sponsor reads, ads, housekeeping, and disconnected introductions or outros.",
      "Use fact-grounded, concise titles and hooks supported by the selected sentences; do not invent quotes or add sensational claims.",
      `Write every hook, title, and reason in ${outputLanguage}; keep the meaning faithful to the transcript.`,
      "Avoid exposing private third-party crisis, health, or financial details; prefer public-interest facts.",
      "Score each candidate from 0 to 10 for hook strength, accuracy, clarity, and shareability.",
      "Do not include timestamps. Return only JSON with a candidates array, no markdown fences.",
      `Transcript chunk ${chunk.index + 1}/${chunks.length}:`,
      source,
    ].join("\n\n");
    const span = chunk.sentences.at(-1)!.end - chunk.sentences[0]!.start;
    const minimumProposals = span >= 150_000 ? 8 : 1;

    try {
      const chunkStarted = performance.now();
      let validated: ReturnType<typeof parseCandidateResponse> | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const retryPrompt = attempt === 0
            ? prompt
            : `${prompt}\n\nYour previous response had too few valid options. Return at least ${minimumProposals} distinct candidates if the transcript supports them.`;
          const value = await llm.generateJson(retryPrompt, SCHEMA);
          const parsed = parseCandidateResponse(value);
          const invalidIds = parsed.candidates.some((candidate) =>
            !chunk.sentences.some((sentence) => sentence.id === candidate.startSentenceId) ||
            !chunk.sentences.some((sentence) => sentence.id === candidate.endSentenceId),
          );
          if (invalidIds) throw new Error("Candidate sentence IDs must belong to this chunk");
          if (attempt === 0 && parsed.candidates.length < minimumProposals) {
            console.warn(`Chunk ${chunk.index + 1} returned ${parsed.candidates.length} candidates; retrying for more options`);
            continue;
          }
          validated = parsed;
          break;
        } catch (error) {
          if (attempt === 1) throw error;
          console.warn(`Chunk ${chunk.index + 1} response invalid; retrying once: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (validated) proposals.push(...validated.candidates);
      console.log(`Pass 1 chunk ${chunk.index + 1}: ${((performance.now() - chunkStarted) / 1000).toFixed(2)}s`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      console.warn(`Skipping chunk ${chunk.index + 1}: ${message}`);
    }
  }

  const pass2Started = performance.now();
  const weighted = proposals.map((proposal) => {
    if (audioWeight === 0 || energyScores.size === 0) return proposal;
    const spanEnergy = sentences
      .filter((sentence) => sentence.id >= proposal.startSentenceId && sentence.id <= proposal.endSentenceId)
      .map((sentence) => energyScores.get(sentence.id))
      .filter((score): score is number => score !== undefined);
    const energy = spanEnergy.length ? spanEnergy.reduce((sum, score) => sum + score, 0) / spanEnergy.length : 0;
    return { ...proposal, score: combineScores(proposal.score, energy, audioWeight) };
  });
  const selected = rankAndMapCandidates(weighted, sentences);
  console.log(`Pass 2 ranking: ${((performance.now() - pass2Started) / 1000).toFixed(2)}s`);
  if (!selected.length) {
    if (!proposals.length && failures.length) {
      throw new Error(`Clip selection failed for all ${chunks.length} transcript chunks. Check the 9Router connection and LLM_API_KEY, then retry. Last error: ${failures.at(-1)}`);
    }
    throw new Error("No clip candidates met the 30–90 second duration requirement. Check the transcript or use a video with more clear spoken content.");
  }
  return selected;
}
