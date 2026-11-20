import type { Transcript } from "../types.ts";
import { chunkSentences } from "./chunks.ts";
import { parseCandidateResponse, rankAndMapCandidates, type ClipCandidate } from "./candidates.ts";
import type { JsonGenerator } from "./llm.ts";
import { transcriptSentences } from "./sentences.ts";
import { combineScores } from "./audio-energy.ts";
import type { ActivityWindow } from "../youtube-analysis.ts";

const SCHEMA = `{"candidates":[{"startSentenceId":0,"endSentenceId":1,"hook":"string","title":"string","score":0,"reason":"string"}]}`;
const MIN_CANDIDATE_SCORE = 7;

export async function selectCandidates(
  transcript: Transcript,
  llm: JsonGenerator,
  energyScores: Map<number, number> = new Map(),
  audioWeight = 0,
  activityWindows: ActivityWindow[] = [],
  chapters: Array<{ start: number; end: number; title: string }> = [],
  minimumProposalsOverride?: number,
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
    const chunkStart = chunk.sentences[0]!.start;
    const chunkEnd = chunk.sentences.at(-1)!.end;
    const activity = activityWindows.filter((window) => window.start < chunkEnd && window.end > chunkStart && (window.chatScore >= 5 || window.heatmapScore >= 5));
    const chunkChapters = chapters.filter((chapter) => chapter.start < chunkEnd && chapter.end > chunkStart).slice(0, 20);
    const outputLanguage = transcript.language.toLowerCase().startsWith("id")
      ? "natural Bahasa Indonesia"
      : `the same language as the transcript (${transcript.language})`;
    const prompt = [
      "Find self-contained short video clips with a strong opening, clear payoff, and no missing context.",
      "Only propose a clip when its selected transcript contains the payoff, not just a setup, question, topic summary, or unresolved claim.",
      "A payoff must be explicit in the transcript: a conclusion, answer, reveal, punchline, decision, or described outcome. Never infer an unseen gameplay result from commentary or reactions.",
      "Return 30–90 second clip candidates. Choose boundaries from the supplied sentence IDs only.",
      ...(minimumProposalsOverride === 1
        ? ["Choose the single strongest self-contained moment in this focused time window. Return one candidate scoring at least 7 only if the transcript supports it."]
        : ["Return 8–10 varied candidate options scoring at least 7 when the transcript allows, spread across distinct topics and time ranges; include non-overlapping alternatives. Quality matters more than meeting the count.", "Aim for at least five final non-overlapping clips by offering alternatives across the full chunk, not several versions of one moment."]),
      "Exclude sponsor reads, ads, housekeeping, and disconnected introductions or outros.",
      "Use fact-grounded, concise titles and hooks supported by the selected sentences; do not invent quotes or add sensational claims.",
      `Write every hook, title, and reason in ${outputLanguage}; keep the meaning faithful to the transcript.`,
      "Avoid exposing private third-party crisis, health, or financial details; prefer public-interest facts.",
      "Score each candidate from 0 to 10 for hook strength, payoff quality, context, accuracy, clarity, and shareability. Return only candidates scoring 7 or higher; if fewer qualify, return fewer.",
      ...(activity.length ? [
        "Use the activity data below only as supporting evidence for a moment's audience reaction or replay interest; it never replaces transcript evidence, and chat spam alone is not a payoff.",
        "Activity windows use milliseconds from the start of the video. Prefer transcript-supported moments that also align with strong audience or replay activity.",
        `Activity windows: ${JSON.stringify(activity.map(({ start, end, chatScore, heatmapScore, chatCount, samples }) => ({ start, end, chatScore, heatmapScore, chatCount, samples })))}`,
      ] : []),
      ...(chunkChapters.length ? [`Video chapters overlapping this transcript: ${JSON.stringify(chunkChapters.map(({ start, end, title }) => ({ start, end, title })))}`] : []),
      "Do not include timestamps. Return only JSON with a candidates array, no markdown fences.",
      `Transcript chunk ${chunk.index + 1}/${chunks.length}:`,
      source,
    ].join("\n\n");
    const span = chunk.sentences.at(-1)!.end - chunk.sentences[0]!.start;
    const minimumProposals = minimumProposalsOverride ?? (span >= 150_000 ? 8 : 1);

    try {
      const chunkStarted = performance.now();
      let validated: ReturnType<typeof parseCandidateResponse> | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const retryPrompt = attempt === 0
            ? prompt
            : `${prompt}\n\nYour previous response had too few valid high-quality options. Return at least ${minimumProposals} distinct candidates scoring 7 or higher if the transcript supports them; do not lower the quality bar to fill the quota.`;
          const value = await llm.generateJson(retryPrompt, SCHEMA);
          const parsed = parseCandidateResponse(value);
          const invalidIds = parsed.candidates.some((candidate) =>
            !chunk.sentences.some((sentence) => sentence.id === candidate.startSentenceId) ||
            !chunk.sentences.some((sentence) => sentence.id === candidate.endSentenceId),
          );
          if (invalidIds) throw new Error("Candidate sentence IDs must belong to this chunk");
          const qualityCandidates = parsed.candidates.filter((candidate) => candidate.score >= MIN_CANDIDATE_SCORE);
          if (attempt === 0 && qualityCandidates.length < minimumProposals) {
            console.warn(`Chunk ${chunk.index + 1} returned ${qualityCandidates.length} candidates scoring at least ${MIN_CANDIDATE_SCORE}; retrying for more options`);
            continue;
          }
          validated = { candidates: qualityCandidates };
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
    let result = proposal;
    if (audioWeight > 0 && energyScores.size > 0) {
    const spanEnergy = sentences
      .filter((sentence) => sentence.id >= proposal.startSentenceId && sentence.id <= proposal.endSentenceId)
      .map((sentence) => energyScores.get(sentence.id))
      .filter((score): score is number => score !== undefined);
    const energy = spanEnergy.length ? spanEnergy.reduce((sum, score) => sum + score, 0) / spanEnergy.length : 0;
      result = { ...result, score: combineScores(result.score, energy, audioWeight) };
    }
    if (!activityWindows.length) return result;
    const first = sentences.find((sentence) => sentence.id === proposal.startSentenceId);
    const last = sentences.find((sentence) => sentence.id === proposal.endSentenceId);
    if (!first || !last) return result;
    const related = activityWindows.filter((window) => window.start < last.end && window.end > first.start);
    if (!related.length) return result;
    const chat = Math.max(...related.map((window) => window.chatScore));
    const heatmap = Math.max(...related.map((window) => window.heatmapScore));
    const hasChat = related.some((window) => window.chatCount > 0);
    const hasHeatmap = heatmap > 0;
    const chatWeight = hasChat ? 0.25 : 0;
    const heatmapWeight = hasHeatmap ? 0.15 : 0;
    const modelWeight = 1 - chatWeight - heatmapWeight;
    const score = Math.round((result.score * modelWeight + chat * chatWeight + heatmap * heatmapWeight) * 10) / 10;
    return { ...result, score, signalScores: { model: proposal.score, chat: hasChat ? chat : 0, heatmap } };
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
