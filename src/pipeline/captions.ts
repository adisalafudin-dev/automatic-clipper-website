import type { Word } from "../types.ts";

export type CaptionWord = { text: string; start: number; end: number };
export type CaptionEvent = { start: number; end: number; words: CaptionWord[] };
export type CaptionStyle = "classic" | "bold" | "clean";
export type CaptionWordEdit = { wordIndex: number; text: string };

export function applyCaptionWordEdits(words: Word[], edits: CaptionWordEdit[] = []): Word[] {
  const replacements = new Map(edits.map((edit) => [edit.wordIndex, edit.text]));
  return words.flatMap((word, wordIndex) => {
    const text = replacements.get(wordIndex) ?? word.text;
    return text.trim() ? [{ ...word, text: text.trim() }] : [];
  });
}

const SENTENCE_END = /[.!?]["'”’)]*$/;

export function captionEvents(
  words: Word[],
  clipStart: number,
  clipEnd: number,
  maxWords = 7,
  maxCharacters = 34,
): CaptionEvent[] {
  const included = words
    .filter((word) => word.end > clipStart && word.start < clipEnd)
    .map((word) => ({
      text: word.text,
      start: Math.max(0, word.start - clipStart),
      end: Math.max(0, Math.min(clipEnd, word.end) - clipStart),
    }));

  const events: CaptionEvent[] = [];
  let current: CaptionWord[] = [];
  let characters = 0;
  const flush = () => {
    if (!current.length) return;
    events.push({ start: current[0]!.start, end: current.at(-1)!.end, words: current });
    current = [];
    characters = 0;
  };

  for (const word of included) {
    const nextLength = characters + (current.length ? 1 : 0) + word.text.length;
    if (current.length && (current.length >= maxWords || nextLength > maxCharacters)) flush();
    current.push(word);
    characters += (current.length > 1 ? 1 : 0) + word.text.length;
    if (SENTENCE_END.test(word.text)) flush();
  }
  flush();
  return events;
}

function assTime(milliseconds: number): string {
  const totalCentiseconds = Math.max(0, Math.floor(milliseconds / 10));
  const hours = Math.floor(totalCentiseconds / 360_000);
  const minutes = Math.floor((totalCentiseconds % 360_000) / 6_000);
  const seconds = Math.floor((totalCentiseconds % 6_000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function escapeAss(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}");
}

export function buildAssStyleLine(style: CaptionStyle): string {
  if (style === "bold") return "Style: Default,Arial,74,&H00FFFFFF,&H007BF2C1,&H00101010,&H90000000,-1,0,1,6,2,5,70,70,0,1";
  if (style === "clean") return "Style: Default,Arial,58,&H00FFFFFF,&H007BF2C1,&H00101010,&H70000000,0,0,1,2,0,5,76,76,0,1";
  return "Style: Default,Arial,66,&H00FFFFFF,&H0000FFFF,&H00101010,&H80000000,-1,0,1,4,1,5,70,70,0,1";
}

export function buildAssTitleEvent(title: string, duration: number, style: CaptionStyle): string | null {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized || duration <= 0) return null;
  const lines = normalized.match(/.{1,28}(?:\s|$)/g)?.map((line) => line.trim()).filter(Boolean) ?? [normalized];
  const escaped = lines.map(escapeAss).join("\\N");
  const settings = style === "bold"
    ? "\\an8\\pos(540,150)\\fs60\\bord4\\shad2\\1c&H00FFFFFF&"
    : style === "clean"
      ? "\\an8\\pos(540,150)\\fs48\\bord2\\shad0\\1c&H00FFFFFF&"
      : "\\an8\\pos(540,150)\\fs54\\bord3\\shad1\\1c&H00FFFFFF&";
  const end = assTime(Math.min(2500, duration));
  return `Dialogue: 1,${assTime(0)},${end},Default,,0,0,0,,{${settings}}${escaped}`;
}

export function buildAss(
  words: Word[],
  clipStart: number,
  clipEnd: number,
  options: { style?: CaptionStyle; preset?: CaptionStyle; title?: string } = {},
): string {
  const style = options.style ?? options.preset ?? "classic";
  const styleLine = buildAssStyleLine(style);
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styleLine,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = captionEvents(words, clipStart, clipEnd).map((event) => {
    const text = event.words.map((word, index) => {
      const nextStart = event.words[index + 1]?.start ?? event.end;
      const duration = Math.max(1, Math.round((nextStart - word.start) / 10));
      return `{\\k${duration}}${escapeAss(word.text)}`;
    }).join(" ");
    return `Dialogue: 0,${assTime(event.start)},${assTime(event.end)},Default,,0,0,0,,${text}`;
  });
  const titleEvent = options.title ? buildAssTitleEvent(options.title, clipEnd - clipStart, style) : null;
  if (titleEvent) events.unshift(titleEvent);
  return `${[...header, ...events].join("\n")}\n`;
}
