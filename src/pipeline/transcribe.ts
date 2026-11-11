import path from "node:path";
import type { Transcript, WhisperSegment } from "../types.ts";
import { wordsFromSegments } from "./words.ts";

const DEFAULT_WHISPER_BIN = path.join(
  "tools",
  "whisper",
  "Release",
  "whisper-cli.exe",
);
const DEFAULT_MODELS_DIR = path.join("tools", "whisper", "models");

// The parts of whisper's -ojf JSON that we read.
type WhisperJson = {
  result: { language: string };
  transcription: WhisperSegment[];
};

// Runs whisper-cli on a WAV file and saves two files in jobDir:
//   whisper.json    = raw whisper output (kept so we can inspect or reparse it)
//   transcript.json = our format: words with start/end in milliseconds
export async function transcribe(
  audioPath: string,
  jobDir: string,
  force = false,
): Promise<Transcript> {
  const model = process.env.WHISPER_MODEL ?? "base";
  const language = process.env.WHISPER_LANG ?? "en";
  const whisperBin = process.env.WHISPER_BIN ?? DEFAULT_WHISPER_BIN;
  const modelsDir = process.env.WHISPER_MODELS_DIR ?? DEFAULT_MODELS_DIR;
  const modelPath =
    process.env.WHISPER_MODEL_PATH || path.join(modelsDir, `ggml-${model}.bin`);
  const transcriptPath = path.join(jobDir, "transcript.json");

  if (!force && (await Bun.file(transcriptPath).exists())) {
    console.log(`Using cached transcript: ${transcriptPath}`);
    return (await Bun.file(transcriptPath).json()) as Transcript;
  }

  // Fail early with a clear message if something is missing.
  if (!(await Bun.file(whisperBin).exists())) {
    throw new Error(`whisper-cli not found at ${whisperBin}`);
  }
  if (!(await Bun.file(modelPath).exists())) {
    throw new Error(
      `Whisper model not found: ${modelPath} (WHISPER_MODEL="${model}")`,
    );
  }
  if (!(await Bun.file(audioPath).exists())) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  // whisper adds ".json" itself, so this prefix produces <jobDir>/whisper.json
  const outPrefix = path.join(jobDir, "whisper");

  const args = [
    whisperBin,
    "-m",
    modelPath, // model file
    "-f",
    audioPath, // input WAV
    "-l",
    language, // spoken language
    "-oj",
    "-ojf", // write JSON, including per-token timestamps
    "-of",
    outPrefix, // output path without extension
  ];

  // whisper prints a lot to stderr, so we capture it and show it only on failure.
  const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(
      `whisper-cli failed (exit code ${exitCode}):\n${stderr.trim()}`,
    );
  }

  const raw = (await Bun.file(`${outPrefix}.json`).json()) as WhisperJson;
  if (!Array.isArray(raw.transcription)) {
    throw new Error("Unexpected whisper JSON: no 'transcription' array");
  }

  const transcript: Transcript = {
    model,
    language: raw.result.language,
    words: wordsFromSegments(raw.transcription),
  };

  await Bun.write(
    transcriptPath,
    JSON.stringify(transcript, null, 2),
  );
  return transcript;
}
