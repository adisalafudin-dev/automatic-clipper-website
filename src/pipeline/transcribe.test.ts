import { expect, test } from "bun:test";
import { buildWhisperArgs } from "./transcribe.ts";

const base = {
  whisperBin: "whisper-cli.exe",
  modelPath: "base.bin",
  audioPath: "audio.wav",
  language: "auto",
  outPrefix: "whisper",
};

test("builds Whisper arguments with VAD and non-speech safeguards", () => {
  expect(buildWhisperArgs({ ...base, vadModelPath: "silero.bin" })).toEqual([
    "whisper-cli.exe", "-m", "base.bin", "-f", "audio.wav", "-l", "auto",
    "-oj", "-ojf", "-of", "whisper", "-sns", "-nf", "-mc", "0", "--vad", "--vad-model", "silero.bin",
    "--vad-threshold", "0.55", "--vad-min-speech-duration-ms", "250",
    "--vad-min-silence-duration-ms", "300", "--vad-speech-pad-ms", "100",
  ]);
});

test("can disable VAD while retaining no-speech safeguards", () => {
  expect(buildWhisperArgs(base).slice(-4)).toEqual(["-sns", "-nf", "-mc", "0"]);
});
