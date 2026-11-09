import path from "node:path";
import { mkdir } from "node:fs/promises";
import { checkFfmpeg } from "./ffmpeg/check.ts";
import { extractAudio } from "./pipeline/extract.ts";
import { transcribe } from "./pipeline/transcribe.ts";
import { RouterClient } from "./pipeline/llm.ts";
import { selectCandidates } from "./pipeline/select.ts";
import type { ClipCandidate } from "./pipeline/candidates.ts";
import type { Transcript } from "./types.ts";

const DEFAULT_MODELS = ["hermes-main", "hermes-gemini", "hermes-nvidia-ollama"];

type ComparisonResult = {
  video: string;
  modelAlias: string;
  responseModels: string[];
  elapsedMs: number;
  transcriptWords: number;
  candidates: ClipCandidate[];
  error?: string;
};

type CompareInput =
  | { kind: "video"; path: string }
  | { kind: "transcript"; path: string };

const DEFAULT_INPUTS: CompareInput[] = [
  { kind: "video", path: path.join("assets", "raw", "Gordon Ramsey VS Woman in COMPLETE denial.mp4") },
  { kind: "video", path: path.join("assets", "raw", "sample.mp4") },
  { kind: "video", path: path.join("assets", "raw", "SPEED GOES PRO, EPISODE 2_ SUNI LEE  (Gymnastics).mp4") },
  { kind: "video", path: path.join("assets", "raw", "SPEED GOES PRO, EPISODE 5_ RANDY ORTON (WWE).mp4") },
  { kind: "transcript", path: path.join("data", "jobs", "your-video", "transcript.json") },
];

function parseArgs(args: string[]) {
  const videos: string[] = [];
  const transcripts: string[] = [];
  let models = DEFAULT_MODELS;
  let prepareOnly = false;
  let force = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--prepare") prepareOnly = true;
    else if (arg === "--force") force = true;
    else if (arg === "--models") {
      const value = args[++index];
      if (!value) throw new Error("--models requires a comma-separated list");
      models = value.split(",").map((model) => model.trim()).filter(Boolean);
    } else if (arg === "--transcript") {
      const value = args[++index];
      if (!value) throw new Error("--transcript requires a transcript.json path");
      transcripts.push(value);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else videos.push(arg);
  }
  const inputs: CompareInput[] = videos.length
    ? videos.map((video) => ({ kind: "video", path: video }))
    : DEFAULT_INPUTS;
  inputs.push(...transcripts.map((transcript) => ({ kind: "transcript" as const, path: transcript })));
  return { inputs, models, prepareOnly, force };
}

function cacheName(model: string): string {
  return `${model.replace(/[^a-zA-Z0-9_-]/g, "-")}.json`;
}

async function main() {
  const { inputs, models, prepareOnly, force } = parseArgs(Bun.argv.slice(2));
  if (!inputs.length || !models.length) throw new Error("Provide at least one video and model");
  await checkFfmpeg();

  for (const input of inputs) {
    let jobId: string;
    let jobDir: string;
    let transcript: Transcript;
    let source: string;
    if (input.kind === "video") {
      if (!(await Bun.file(input.path).exists())) throw new Error(`Video not found: ${input.path}`);
      source = input.path;
      jobId = path.parse(input.path).name;
      jobDir = path.join("data", "jobs", jobId);
      const wavPath = path.join(jobDir, "audio", "audio.wav");
      const audioStart = performance.now();
      if (force || !(await Bun.file(wavPath).exists())) await extractAudio(input.path, wavPath);
      console.log(`${jobId} audio: ${((performance.now() - audioStart) / 1000).toFixed(2)}s`);
      const transcriptionStart = performance.now();
      transcript = await transcribe(wavPath, jobDir, force);
      console.log(`${jobId} transcription: ${((performance.now() - transcriptionStart) / 1000).toFixed(2)}s`);
    } else {
      if (!(await Bun.file(input.path).exists())) throw new Error(`Transcript not found: ${input.path}`);
      source = input.path;
      jobDir = path.dirname(input.path);
      jobId = path.basename(jobDir);
      transcript = (await Bun.file(input.path).json()) as Awaited<ReturnType<typeof transcribe>>;
      console.log(`${jobId} transcription: loaded cached transcript`);
    }
    if (prepareOnly) continue;

    const comparisonDir = path.join(jobDir, "comparisons");
    await mkdir(comparisonDir, { recursive: true });
    for (const model of models) {
      const resultPath = path.join(comparisonDir, cacheName(model));
      if (!force && (await Bun.file(resultPath).exists())) {
        const cached = (await Bun.file(resultPath).json()) as ComparisonResult;
        console.log(`${jobId} / ${model}: cached ${cached.candidates.length} clips`);
        continue;
      }

      const started = performance.now();
      const client = new RouterClient({ ...process.env, LLM_MODEL: model });
      let result: ComparisonResult;
      try {
        const candidates = await selectCandidates(transcript, client);
        result = {
          video: source,
          modelAlias: model,
          responseModels: [...client.responseModels],
          elapsedMs: Math.round(performance.now() - started),
          transcriptWords: transcript.words.length,
          candidates,
        };
      } catch (error) {
        result = {
          video: source,
          modelAlias: model,
          responseModels: [...client.responseModels],
          elapsedMs: Math.round(performance.now() - started),
          transcriptWords: transcript.words.length,
          candidates: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
      await Bun.write(resultPath, JSON.stringify(result, null, 2));
      const status = result.error ? `failed: ${result.error}` : `${result.candidates.length} clips`;
      console.log(`${jobId} / ${model}: ${status} in ${(result.elapsedMs / 1000).toFixed(1)}s; actual model(s): ${result.responseModels.join(", ") || "unreported"}`);
    }
  }
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
