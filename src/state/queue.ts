import path from "node:path";
import { runPipeline, type PipelineProgress, type PipelineResult } from "../pipeline/run.ts";
import { JobStore } from "./jobs.ts";

export type PipelineRunner = (
  videoPath: string,
  jobDir: string,
  force: boolean,
  reportProgress: PipelineProgress,
) => Promise<PipelineResult>;

type QueueItem = {
  id: string;
  videoPath: string;
  force: boolean;
};

export class JobQueue {
  private readonly pending: QueueItem[] = [];
  private draining = false;

  constructor(
    private readonly store: JobStore,
    private readonly pipeline: PipelineRunner = runPipeline,
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
        const jobDir = path.join("data", "jobs", item.id);
        this.store.markRunning(item.id);
        try {
          const result = await this.pipeline(
            item.videoPath,
            jobDir,
            item.force,
            (stage, progress) => this.store.updateProgress(item.id, stage, progress),
          );
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
