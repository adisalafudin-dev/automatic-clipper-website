import type { Sentence } from "./sentences.ts";

export type ProposedCandidate = {
  startSentenceId: number;
  endSentenceId: number;
  hook: string;
  title: string;
  score: number;
  reason: string;
};

export type ClipCandidate = ProposedCandidate & {
  start: number;
  end: number;
};

export type CandidateResponse = { candidates: ProposedCandidate[] };

export function parseCandidateResponse(value: unknown): CandidateResponse {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("candidates" in value)) {
    throw new Error("Response must be an object with a candidates array");
  }
  const response = value as Record<string, unknown>;
  if (Object.keys(response).some((key) => key !== "candidates")) {
    throw new Error("Response contains unexpected fields");
  }
  const candidates = response.candidates;
  if (!Array.isArray(candidates)) throw new Error("candidates must be an array");

  return {
    candidates: candidates.map((candidate, index) => {
      if (!candidate || typeof candidate !== "object") {
        throw new Error(`Candidate ${index} must be an object`);
      }
      const item = candidate as Record<string, unknown>;
      const expectedKeys = new Set([
        "startSentenceId", "endSentenceId", "hook", "title", "score", "reason",
      ]);
      if (Object.keys(item).length !== expectedKeys.size || Object.keys(item).some((key) => !expectedKeys.has(key))) {
        throw new Error(`Candidate ${index} contains missing or unexpected fields`);
      }
      const { startSentenceId, endSentenceId, hook, title, score, reason } = item;
      if (!Number.isInteger(startSentenceId) || !Number.isInteger(endSentenceId)) {
        throw new Error(`Candidate ${index} sentence IDs must be integers`);
      }
      if (typeof hook !== "string" || !hook.trim()) throw new Error(`Candidate ${index} hook is required`);
      if (typeof title !== "string" || !title.trim()) throw new Error(`Candidate ${index} title is required`);
      if (typeof reason !== "string" || !reason.trim()) throw new Error(`Candidate ${index} reason is required`);
      if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 10) {
        throw new Error(`Candidate ${index} score must be between 0 and 10`);
      }
      return {
        startSentenceId: startSentenceId as number,
        endSentenceId: endSentenceId as number,
        hook: hook.trim(),
        title: title.trim(),
        score,
        reason: reason.trim(),
      };
    }),
  };
}

export function rankAndMapCandidates(
  proposals: ProposedCandidate[],
  sentences: Sentence[],
  minimumDuration = 30_000,
  maximumDuration = 90_000,
  limit = 10,
): ClipCandidate[] {
  const byId = new Map(sentences.map((sentence) => [sentence.id, sentence]));
  const ranked = proposals
    .flatMap((proposal) => {
      const first = byId.get(proposal.startSentenceId);
      const last = byId.get(proposal.endSentenceId);
      if (!first || !last || proposal.startSentenceId > proposal.endSentenceId) return [];
      const start = first.start;
      const end = last.end;
      if (end - start < minimumDuration || end - start > maximumDuration) return [];
      return [{ ...proposal, start, end }];
    })
    .sort((a, b) => a.end - b.end || a.start - b.start || b.score - a.score);

  type State = { score: number; candidates: ClipCandidate[] };
  const best: Array<Array<State | undefined>> = Array.from(
    { length: ranked.length + 1 },
    () => Array(limit + 1).fill(undefined),
  );
  best[0]![0] = { score: 0, candidates: [] };

  for (let i = 1; i <= ranked.length; i++) {
    const candidate = ranked[i - 1]!;
    let previousCompatible = i - 1;
    while (previousCompatible > 0 && ranked[previousCompatible - 1]!.end > candidate.start) {
      previousCompatible--;
    }
    for (let count = 0; count <= limit; count++) {
      best[i]![count] = best[i - 1]![count];
      if (count === 0) continue;
      const prior = best[previousCompatible]![count - 1];
      if (!prior) continue;
      const included: State = {
        score: prior.score + candidate.score,
        candidates: [...prior.candidates, candidate],
      };
      const existing = best[i]![count];
      if (!existing || included.score > existing.score) best[i]![count] = included;
    }
  }

  for (let count = limit; count > 0; count--) {
    const selection = best[ranked.length]![count];
    if (selection) return selection.candidates.sort((a, b) => a.start - b.start);
  }
  return [];
}
