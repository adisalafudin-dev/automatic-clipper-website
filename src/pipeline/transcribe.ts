import path from "node:path";
import { rm } from "node:fs/promises";
import type { Transcript, WhisperSegment } from "../types.ts";
import { wordsFromSegments } from "./words.ts";

const DEFAULT_WHISPER_BIN = path.join(
  "tools",
  "whisper",
  "Release",
  "whisper-cli.exe",
);
const DEFAULT_MODELS_DIR = path.join("tools", "whisper", "models");
export const DEFAULT_VAD_MODEL_FILE = "ggml-silero-v6.2.0.bin";

export type WhisperArgsOptions = {
  whisperBin: string;
  modelPath: string;
  audioPath: string;
  language: string;
  outPrefix: string;
  vadModelPath?: string;
};

export function buildWhisperArgs(options: WhisperArgsOptions): string[] {
  const args = [options.whisperBin, "-m", options.modelPath, "-f", options.audioPath,
    "-l", options.language, "-oj", "-ojf", "-of", options.outPrefix,
    "-sns", "-nf", "-mc", "0"];
  if (options.vadModelPath) args.push("--vad", "--vad-model", options.vadModelPath,
    "--vad-threshold", "0.55", "--vad-min-speech-duration-ms", "250",
    "--vad-min-silence-duration-ms", "300", "--vad-speech-pad-ms", "100");
  return args;
}

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
  requestedLanguage = process.env.WHISPER_LANG ?? "auto",
  signal?: AbortSignal,
): Promise<Transcript> {
  const model = process.env.WHISPER_MODEL ?? "base";
  const language = requestedLanguage;
  const whisperBin = process.env.WHISPER_BIN ?? DEFAULT_WHISPER_BIN;
  const modelsDir = process.env.WHISPER_MODELS_DIR ?? DEFAULT_MODELS_DIR;
  const modelPath =
    process.env.WHISPER_MODEL_PATH || path.join(modelsDir, `ggml-${model}.bin`);
  const vadEnabled = process.env.WHISPER_VAD !== "false";
  const vadModelPath = process.env.WHISPER_VAD_MODEL_PATH || path.join(modelsDir, DEFAULT_VAD_MODEL_FILE);
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
  if (vadEnabled && !(await Bun.file(vadModelPath).exists())) {
    throw new Error(`Whisper VAD model not found: ${vadModelPath}. Run bun run download-vad-model or set WHISPER_VAD=false.`);
  }
  if (!(await Bun.file(audioPath).exists())) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  // whisper adds ".json" itself, so this prefix produces <jobDir>/whisper.json
  const outPrefix = path.join(jobDir, "whisper");

  const args = buildWhisperArgs({
    whisperBin, modelPath, audioPath, language, outPrefix,
    ...(vadEnabled ? { vadModelPath } : {}),
  });

  // whisper prints a lot to stderr, so we capture it and show it only on failure.
  const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe", signal });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (signal?.aborted) {
    await rm(`${outPrefix}.json`, { force: true });
    throw new Error("Transcription cancelled");
  }
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
    words: wordsFromSegments(raw.transcription, vadEnabled),
  };

  await Bun.write(
    transcriptPath,
    JSON.stringify(transcript, null, 2),
  );
  return transcript;
}
