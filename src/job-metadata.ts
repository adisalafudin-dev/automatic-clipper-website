import path from "node:path";
import { mkdir } from "node:fs/promises";
import { getMode, type ModeName } from "./modes.ts";

export type JobMetadata = Record<string, unknown>;

function isRecord(value: unknown): value is JobMetadata {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJobMetadata(jobDir: string): Promise<JobMetadata> {
  const metadataFile = Bun.file(path.join(jobDir, "job.json"));
  if (!(await metadataFile.exists())) return {};
  const metadata: unknown = await metadataFile.json();
  if (!isRecord(metadata)) throw new Error(`Job metadata must be a JSON object: ${metadataFile.name}`);
  return metadata;
}

export function resolveJobMode(requested: string | undefined, saved: unknown): ModeName {
  if (requested !== undefined) return getMode(requested).name as ModeName;
  if (saved === undefined) return "default";
  if (typeof saved !== "string") throw new Error("Saved job mode must be a string");
  return getMode(saved).name as ModeName;
}

export async function saveJobMetadata(jobDir: string, metadata: JobMetadata): Promise<void> {
  await mkdir(jobDir, { recursive: true });
  await Bun.write(path.join(jobDir, "job.json"), JSON.stringify(metadata, null, 2));
}
