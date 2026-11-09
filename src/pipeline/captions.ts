import type { Word } from "../types.ts";

export type CaptionWord = { text: string; start: number; end: number };
export type CaptionEvent = { start: number; end: number; words: CaptionWord[] };
export type CaptionStyle = "classic" | "bold" | "clean";

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

export function buildAss(
  words: Word[],
  clipStart: number,
  clipEnd: number,
  options: { style?: CaptionStyle; title?: string } = {},
): string {
  const style = options.style ?? "classic";
  const styleLine = style === "bold"
    ? "Style: Default,Arial,74,&H00FFFFFF,&H007BF2C1,&H00101010,&H90000000,-1,0,1,6,2,2,70,70,150,1"
    : style === "clean"
      ? "Style: Default,Arial,58,&H00FFFFFF,&H007BF2C1,&H00101010,&H70000000,0,0,1,2,0,2,76,76,135,1"
      : "Style: Default,Arial,66,&H00FFFFFF,&H0000FFFF,&H00101010,&H80000000,-1,0,1,4,1,2,70,70,130,1";
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
  if (options.title?.trim()) {
    const title = options.title.trim().replace(/\s+/g, " ");
    const titleText = title.match(/.{1,28}(?:\s|$)/g)?.map((line) => line.trim()).filter(Boolean).join("\\N") ?? title;
    events.unshift(`Dialogue: 1,${assTime(0)},${assTime(clipEnd - clipStart)},Default,,0,0,0,,{\\an8\\pos(540,150)\\fs54\\bord3\\shad1}${escapeAss(titleText)}`);
  }
  return `${[...header, ...events].join("\n")}\n`;
}
