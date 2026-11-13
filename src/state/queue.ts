import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { runPipeline, type PipelineOptions, type PipelineProgress, type PipelineResult } from "../pipeline/run.ts";
import { renderClips, type ClipRenderEdit } from "../pipeline/render.ts";
import type { Transcript } from "../types.ts";
import type { ClipCandidate } from "../pipeline/candidates.ts";
import { JobStore } from "./jobs.ts";
import type { ModeName } from "../modes.ts";

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
  language?: string;
  mode?: ModeName;
  clipId?: string;
  onlyStale?: boolean;
};

type RenderRunner = (videoPath: string, jobDir: string, report: PipelineProgress, faceTracking: boolean, clipId?: string, onlyStale?: boolean, mode?: ModeName) => Promise<PipelineResult>;

async function renderExisting(videoPath: string, jobDir: string, report: PipelineProgress, faceTracking: boolean, clipId?: string, onlyStale = false, mode: ModeName = "default"): Promise<PipelineResult> {
  report("rendering", 0);
  const transcript = JSON.parse(await readFile(path.join(jobDir, "transcript.json"), "utf8")) as Transcript;
  const storedCandidates = JSON.parse(await readFile(path.join(jobDir, "candidates.json"), "utf8")) as ClipCandidate[];
  const candidates = storedCandidates.map((candidate, index) => ({
    ...candidate,
    id: candidate.id ?? `clip-${String(index + 1).padStart(2, "0")}`,
  }));
  if (candidates.some((candidate, index) => candidate.id !== storedCandidates[index]!.id)) {
    await writeFile(path.join(jobDir, "candidates.json"), JSON.stringify(candidates, null, 2));
  }
  let edits: Record<string, ClipRenderEdit> = {};
  try {
    edits = JSON.parse(await readFile(path.join(jobDir, "edits.json"), "utf8")) as Record<string, ClipRenderEdit>;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  let selected = candidates;
  if (clipId) selected = candidates.filter((candidate) => candidate.id === clipId);
  else if (onlyStale) {
    selected = [];
    for (const candidate of candidates) {
      const id = candidate.id!;
      const edit = edits[id];
      const outputExists = await Bun.file(path.join(jobDir, "clips", `${id}.mp4`)).exists();
      if (["none", "queued", "rendering", "failed"].includes(edit?.renderStatus ?? "") || !outputExists) selected.push(candidate);
    }
  }
  if (clipId && !selected.length) throw new Error(`Clip ${clipId} is missing its candidate data`);
  const renderedManifest = await renderClips(videoPath, jobDir, transcript, selected, true, edits, faceTracking);
  const manifest = { ...renderedManifest, mode };
  await Bun.write(path.join(jobDir, "clips.json"), JSON.stringify(manifest, null, 2));
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
        let activeRenderIds: string[] = [];
        try {
          const report = (stage: Parameters<typeof this.store.updateProgress>[1], progress: number) =>
            this.store.updateProgress(item.id, stage, progress);
          const renderIds = item.operation === "render"
            ? item.clipId ? [item.clipId] : await staleIds(jobDir, item.onlyStale === true)
            : [];
          activeRenderIds = renderIds;
          if (renderIds.length) await updateRenderStatus(jobDir, renderIds, "rendering");
          let result: PipelineResult;
          if (item.operation === "render") {
            const rendered = await this.renderer(
              item.videoPath,
              jobDir,
              report,
              item.faceTracking === true,
              item.clipId,
              item.onlyStale,
              item.mode,
            );
            const manifest = { ...rendered.manifest, mode: item.mode ?? "default" };
            await Bun.write(path.join(jobDir, "clips.json"), JSON.stringify(manifest, null, 2));
            result = { ...rendered, manifest };
          } else {
            result = await this.pipeline(item.videoPath, jobDir, item.force, report, {
              faceTracking: item.faceTracking === true,
              language: item.language,
              mode: item.mode,
            });
          }
          if (renderIds.length) await updateRenderStatus(jobDir, result.manifest.clips.map((clip) => clip.id), "done");
          if (item.clipId || item.onlyStale) {
            const current = this.store.get(item.id)?.result;
            if (!current || (item.clipId && !result.manifest.clips[0])) throw new Error(`Clip ${item.clipId ?? "stale"} render result could not be merged`);
            const updatedById = new Map(result.manifest.clips.map((clip) => [clip.id, clip]));
            const clips = current.clips.map((clip) => updatedById.get(clip.id) ?? clip);
            const manifest = { ...current, mode: item.mode ?? current.mode ?? "default", clips };
            await Bun.write(path.join(jobDir, "clips.json"), JSON.stringify(manifest, null, 2));
            this.store.complete(item.id, manifest);
          } else this.store.complete(item.id, result.manifest);
        } catch (error) {
          if (item.operation === "render") {
            if (activeRenderIds.length) await updateRenderStatus(jobDir, activeRenderIds, "failed", error instanceof Error ? error.message : String(error));
          }
          this.store.fail(item.id, error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      this.draining = false;
      if (this.pending.length) void this.drain();
    }
  }
}

async function staleIds(jobDir: string, onlyStale: boolean): Promise<string[]> {
  const candidates = JSON.parse(await readFile(path.join(jobDir, "candidates.json"), "utf8")) as ClipCandidate[];
  if (!onlyStale) return candidates.map((candidate, index) => candidate.id ?? `clip-${String(index + 1).padStart(2, "0")}`);
  let edits: Record<string, ClipRenderEdit> = {};
  try { edits = JSON.parse(await readFile(path.join(jobDir, "edits.json"), "utf8")) as Record<string, ClipRenderEdit>; }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  const stale: string[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const id = candidate.id ?? `clip-${String(index + 1).padStart(2, "0")}`;
    const exists = await Bun.file(path.join(jobDir, "clips", `${id}.mp4`)).exists();
    if (["none", "queued", "rendering", "failed"].includes(edits[id]?.renderStatus ?? "") || !exists) stale.push(id);
  }
  return stale;
}

async function updateRenderStatus(jobDir: string, ids: string[], renderStatus: "rendering" | "done" | "failed", renderError?: string): Promise<void> {
  let edits: Record<string, ClipRenderEdit> = {};
  try { edits = JSON.parse(await readFile(path.join(jobDir, "edits.json"), "utf8")) as Record<string, ClipRenderEdit>; }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  for (const id of ids) {
    const previous = edits[id] ?? {};
    edits[id] = {
      ...previous,
      renderStatus,
      ...(renderStatus === "done" ? { renderedAt: new Date().toISOString(), renderError: undefined } : {}),
      ...(renderStatus === "failed" ? { renderError } : {}),
    };
  }
  await writeFile(path.join(jobDir, "edits.json"), JSON.stringify(edits, null, 2));
}
