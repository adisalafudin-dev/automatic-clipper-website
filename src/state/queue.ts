import path from "node:path";
import { readFile } from "node:fs/promises";
import { runPipeline, type PipelineOptions, type PipelineProgress, type PipelineResult } from "../pipeline/run.ts";
import { renderClips, type ClipRenderEdit } from "../pipeline/render.ts";
import type { Transcript } from "../types.ts";
import type { ClipCandidate } from "../pipeline/candidates.ts";
import { JobStore } from "./jobs.ts";

export type PipelineRunner = (
  videoPath: string,
  jobDir: string,
  force: boolean,
  reportProgress: PipelineProgress,
  options: PipelineOptions,
) => Promise<PipelineResult>;

type QueueItem = {
  id: string;
  videoPath: string;
  force: boolean;
  operation?: "pipeline" | "render";
  faceTracking?: boolean;
};

type RenderRunner = (videoPath: string, jobDir: string, report: PipelineProgress, faceTracking: boolean) => Promise<PipelineResult>;

async function renderExisting(videoPath: string, jobDir: string, report: PipelineProgress, faceTracking: boolean): Promise<PipelineResult> {
  report("rendering", 0);
  const transcript = JSON.parse(await readFile(path.join(jobDir, "transcript.json"), "utf8")) as Transcript;
  const candidates = JSON.parse(await readFile(path.join(jobDir, "candidates.json"), "utf8")) as ClipCandidate[];
  let edits: Record<string, ClipRenderEdit> = {};
  try {
    edits = JSON.parse(await readFile(path.join(jobDir, "edits.json"), "utf8")) as Record<string, ClipRenderEdit>;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const manifest = await renderClips(videoPath, jobDir, transcript, candidates, true, edits, faceTracking);
  report("rendering", 100);
  return { manifest, transcriptWords: transcript.words.length, candidateCount: candidates.length };
}

export class JobQueue {
  private readonly pending: QueueItem[] = [];
  private draining = false;

  constructor(
    private readonly store: JobStore,
    private readonly pipeline: PipelineRunner = runPipeline,
    private readonly renderer: RenderRunner = renderExisting,
    private readonly jobRoot: string = path.join("data", "jobs"),
  ) {}

  enqueue(item: QueueItem): void {
    this.pending.push(item);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length) {
        const item = this.pending.shift()!;
        const jobDir = path.join(this.jobRoot, item.id);
        this.store.markRunning(item.id);
        try {
          const report = (stage: Parameters<typeof this.store.updateProgress>[1], progress: number) =>
            this.store.updateProgress(item.id, stage, progress);
          const result = item.operation === "render"
            ? await this.renderer(item.videoPath, jobDir, report, item.faceTracking === true)
            : await this.pipeline(item.videoPath, jobDir, item.force, report, { faceTracking: item.faceTracking === true });
          this.store.complete(item.id, result.manifest);
        } catch (error) {
          this.store.fail(item.id, error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      this.draining = false;
      if (this.pending.length) void this.drain();
    }
  }
}
