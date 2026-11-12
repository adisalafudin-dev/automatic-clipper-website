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

export type ClipLanguage = "en" | "id";

export type JobListItem = {
  id: string;
  filename: string;
  language: ClipLanguage;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  progress: number;
  error: string | null;
  createdAt: string;
};

export type JobView = JobListItem & {
  videoPath: string;
  faceTracking: boolean;
  stages: Record<string, { status: string; progress: number }>;
  result: { source: string; clips: Array<{
    id: string; file: string; captions: string; start: number; end: number; duration: number;
    startSentenceId: number; endSentenceId: number; title: string; hook: string; score: number; reason: string;
  }> } | null;
  updatedAt: string;
};

export type UiClipEdit = {
  startMs?: number;
  endMs?: number;
  origStartMs?: number;
  origEndMs?: number;
  caption?: string;
  captionWords?: Array<{ wordIndex: number; text: string }>;
  style?: "classic" | "bold" | "clean";
  titleOverlay?: boolean;
  layout?: "crop" | "blurred" | "stacked";
  renderStatus?: "none" | "queued" | "rendering" | "done" | "failed";
  renderError?: string;
  renderedAt?: string;
};

export type UiWord = { text: string; start: number; end: number; wordIndex?: number };
export type UiSentence = { id: number; text: string; start: number; end: number; words: UiWord[] };
