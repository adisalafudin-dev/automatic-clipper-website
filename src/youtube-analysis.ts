import type { Transcript, Word } from "./types.ts";

export type CaptionCue = { start: number; end: number; text: string };
export type ChatBucket = { start: number; end: number; count: number; uniqueCount: number; samples: string[] };
export type HeatmapSpan = { start: number; end: number; value: number };
export type ActivityWindow = { start: number; end: number; chatScore: number; heatmapScore: number; chatCount: number; samples: string[] };
export type YouTubeAnalysisSignals = { windows: ActivityWindow[]; chapters: Array<{ start: number; end: number; title: string }> };
export type AnalysisRange = { start: number; end: number; activityScore: number };

function parseCueTime(value: string): number | null {
  const parts = value.trim().replace(",", ".").split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts[0]) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite) || seconds < 0 || seconds >= 60 || minutes < 0 || minutes >= 60 || hours < 0) return null;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function cleanCueText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
}

export function parseCaptionCues(input: string): CaptionCue[] {
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const blocks = normalized.split(/\n{2,}/);
  const cues: CaptionCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const match = /^\s*(\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}/.exec(lines[timingIndex]!);
    if (!match) continue;
    const timing = lines[timingIndex]!.split("-->");
    const startText = timing[0]!.trim();
    const endText = timing[1]!.trim().split(/\s+/)[0]!;
    const start = parseCueTime(startText);
    const end = parseCueTime(endText);
    const text = cleanCueText(lines.slice(timingIndex + 1).join(" "));
    if (start === null || end === null || end <= start || !text) continue;
    cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function captionsToTranscript(cues: CaptionCue[], language: string): Transcript {
  const words: Word[] = [];
  for (const cue of cues) {
    const tokens = cue.text.split(/\s+/).filter(Boolean);
    const weights = tokens.map((word) => Math.max(1, word.length));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let offset = 0;
    for (let i = 0; i < tokens.length; i++) {
      const start = cue.start + Math.round((cue.end - cue.start) * offset / total);
      offset += weights[i]!;
      const end = Math.max(start + 1, cue.start + Math.round((cue.end - cue.start) * offset / total));
      words.push({ text: tokens[i]!, start, end: Math.min(cue.end, end) });
    }
  }
  return { model: "youtube-captions", language, words };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFromAction(value: unknown): string | null {
  const visit = (node: unknown, depth: number): string | null => {
    if (depth > 8 || !isRecord(node)) return null;
    for (const [key, child] of Object.entries(node)) {
      if (key.endsWith("Renderer") && isRecord(child)) {
        const message = child.message;
        if (isRecord(message)) {
          if (typeof message.simpleText === "string") return cleanCueText(message.simpleText);
          if (Array.isArray(message.runs)) {
            const text = message.runs.flatMap((run) => isRecord(run) && typeof run.text === "string" ? [run.text] : []).join("");
            if (text.trim()) return cleanCueText(text);
          }
        }
      }
      const found = Array.isArray(child)
        ? child.map((item) => visit(item, depth + 1)).find((text): text is string => Boolean(text))
        : visit(child, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return visit(value, 0);
}

export function parseLiveChatJsonl(input: string): ChatBucket[] {
  const buckets = new Map<number, { count: number; messages: Set<string>; samples: string[] }>();
  for (const line of input.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    if (!isRecord(value) || !isRecord(value.replayChatItemAction)) continue;
    const replay = value.replayChatItemAction;
    const offset = Number(replay.videoOffsetTimeMsec);
    if (!Number.isFinite(offset) || offset < 0 || !Array.isArray(replay.actions)) continue;
    const messages = replay.actions.map(messageFromAction).filter((message): message is string => Boolean(message));
    for (const message of messages) {
      const bucketStart = Math.floor(offset / 30_000) * 30_000;
      const bucket = buckets.get(bucketStart) ?? { count: 0, messages: new Set<string>(), samples: [] };
      bucket.count++;
      const normalized = message.toLocaleLowerCase().replace(/\s+/g, " ").trim();
      bucket.messages.add(normalized);
      if (bucket.samples.length < 3 && !bucket.samples.includes(message)) bucket.samples.push(message.slice(0, 140));
      buckets.set(bucketStart, bucket);
    }
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([start, bucket]) => ({
    start, end: start + 30_000, count: bucket.count, uniqueCount: bucket.messages.size, samples: bucket.samples,
  }));
}

export function extractHeatmap(value: unknown): HeatmapSpan[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const start = Number(item.start_time);
    const end = Number(item.end_time);
    const score = Number(item.value);
    if (![start, end, score].every(Number.isFinite) || start < 0 || end <= start) return [];
    return [{ start: Math.round(start * 1000), end: Math.round(end * 1000), value: Math.max(0, score) }];
  });
}

function normalize(values: number[]): number[] {
  if (!values.length) return [];
  const positive = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (!positive.length) return values.map(() => 0);
  const ceiling = positive[Math.min(positive.length - 1, Math.floor(positive.length * 0.9))]!;
  return values.map((value) => value <= 0 ? 0 : Math.round(Math.min(10, value / ceiling * 10) * 10) / 10);
}

export function buildActivityWindows(durationMs: number, chat: ChatBucket[], heatmap: HeatmapSpan[], chapters: Array<{ start: number; end: number; title: string }> = []): YouTubeAnalysisSignals {
  const count = Math.max(0, Math.ceil(durationMs / 30_000));
  const rawChat = Array.from({ length: count }, (_, index) => chat.find((bucket) => bucket.start === index * 30_000)?.uniqueCount ?? 0);
  const rawHeat = Array.from({ length: count }, (_, index) => {
    const start = index * 30_000;
    return heatmap.filter((span) => span.start < start + 30_000 && span.end > start).reduce((max, span) => Math.max(max, span.value), 0);
  });
  const chatScores = normalize(rawChat);
  const heatScores = normalize(rawHeat);
  return {
    windows: Array.from({ length: count }, (_, index) => {
      const bucket = chat.find((item) => item.start === index * 30_000);
      return { start: index * 30_000, end: Math.min(durationMs, (index + 1) * 30_000), chatScore: chatScores[index] ?? 0, heatmapScore: heatScores[index] ?? 0, chatCount: bucket?.uniqueCount ?? 0, samples: bucket?.samples ?? [] };
    }),
    chapters,
  };
}

export function selectSpikeRanges(windows: ActivityWindow[], durationMs: number, limit = 15, marginMs = 120_000): AnalysisRange[] {
  const peaks = [...windows]
    .map((window) => ({ window, score: window.chatScore * 0.6 + window.heatmapScore * 0.4 }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.window.start - b.window.start)
    .slice(0, limit)
    .map(({ window, score }) => ({ start: Math.max(0, window.start - marginMs), end: Math.min(durationMs, window.end + marginMs), activityScore: score }))
    .sort((a, b) => a.start - b.start);
  const merged: AnalysisRange[] = [];
  for (const peak of peaks) {
    const previous = merged.at(-1);
    if (previous && peak.start <= previous.end) {
      previous.end = Math.max(previous.end, peak.end);
      previous.activityScore = Math.max(previous.activityScore, peak.activityScore);
    } else merged.push({ ...peak });
  }
  return merged;
}
