import type { Transcript, Word } from "../types.ts";

export type Sentence = {
  id: number;
  text: string;
  start: number;
  end: number;
};

const SENTENCE_END = /[.!?]["'”’)]*$/;

export function splitSentences(words: Word[]): Sentence[] {
  const sentences: Sentence[] = [];
  let current: Word[] = [];

  const flush = () => {
    if (!current.length) return;
    sentences.push({
      id: sentences.length,
      text: current.map((word) => word.text).join(" "),
      start: current[0]!.start,
      end: current[current.length - 1]!.end,
    });
    current = [];
  };

  for (const word of words) {
    current.push(word);
    if (SENTENCE_END.test(word.text)) flush();
  }
  flush();
  return sentences;
}

export function transcriptSentences(transcript: Transcript): Sentence[] {
  return splitSentences(transcript.words);
}
