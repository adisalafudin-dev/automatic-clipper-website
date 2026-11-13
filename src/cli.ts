import path from "node:path";
import { runPipeline } from "./pipeline/run.ts";
import { parseCliArgs } from "./cli-options.ts";

async function main() {
  console.log(`Clipper CLI starting on Bun ${Bun.version}`);
  const options = parseCliArgs(Bun.argv.slice(2));
  const videoPath = options.videoPath;
  if (!videoPath) throw new Error("Usage: bun run src/cli.ts <video-file> [--force] [--face-track] [--mode <default|gaming|podcast>]");

  const jobId = path.parse(videoPath).name;
  const jobDir = path.join("data", "jobs", jobId);
  const result = await runPipeline(videoPath, jobDir, options.force, undefined, {
    faceTracking: options.faceTracking,
    mode: options.mode,
  });
  console.log(`Mode: ${result.manifest.mode}`);
  console.log(`Transcript words: ${result.transcriptWords}`);
  console.log(`Candidates and rendered clips: ${result.candidateCount}`);
  console.log(`Manifest: ${path.join(jobDir, "clips.json")}`);
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
