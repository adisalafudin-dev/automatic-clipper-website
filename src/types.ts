// The parts of whisper-cli's -ojf JSON that we use. Times are in milliseconds.
export type WhisperToken = {
  text: string;
  offsets: { from: number; to: number };
};

export type WhisperSegment = {
  tokens: WhisperToken[];
};

// One spoken word. start/end are milliseconds from the start of the audio.
export type Word = {
  text: string;
  start: number;
  end: number;
};

// Our own transcript format, saved as transcript.json.
export type Transcript = {
  model: string;
  language: string;
  words: Word[];
};
