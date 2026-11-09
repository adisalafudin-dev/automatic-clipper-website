import path from "node:path";
import { runPipeline } from "./pipeline/run.ts";

async function main() {
  console.log(`Clipper CLI starting on Bun ${Bun.version}`);
  const args = Bun.argv.slice(2);
  const force = args.includes("--force");
  const videoPath = args.find((arg) => arg !== "--force");
  if (!videoPath) throw new Error("Usage: bun run src/cli.ts <video-file> [--force]");

  const jobId = path.parse(videoPath).name;
  const jobDir = path.join("data", "jobs", jobId);
  const result = await runPipeline(videoPath, jobDir, force);
  console.log(`Transcript words: ${result.transcriptWords}`);
  console.log(`Candidates and rendered clips: ${result.candidateCount}`);
  console.log(`Manifest: ${path.join(jobDir, "clips.json")}`);
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
