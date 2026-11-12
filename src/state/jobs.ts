import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { ClipsManifest } from "../pipeline/render.ts";
import { PIPELINE_STAGES, type PipelineStage } from "../pipeline/run.ts";
import type { ClipLanguage } from "../types.ts";

export type JobStatus = "queued" | "running" | "completed" | "failed";
export type StageStatus = "pending" | "running" | "completed" | "failed";

export type JobStage = {
  status: StageStatus;
  progress: number;
};

export type JobStages = Record<PipelineStage, JobStage>;

export type Job = {
  id: string;
  videoPath: string;
  faceTracking: boolean;
  language: ClipLanguage;
  status: JobStatus;
  stage: string;
  progress: number;
  stages: JobStages;
  error: string | null;
  result: ClipsManifest | null;
  createdAt: string;
  updatedAt: string;
};

type JobRow = {
  id: string;
  video_path: string;
  face_tracking: number;
  language: ClipLanguage;
  status: JobStatus;
  stage: string;
  progress: number;
  stages_json: string;
  error: string | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
};

function initialStages(): JobStages {
  return Object.fromEntries(PIPELINE_STAGES.map((stage) => [
    stage,
    { status: "pending", progress: 0 },
  ])) as JobStages;
}

function fromRow(row: JobRow): Job {
  return {
    id: row.id,
    videoPath: row.video_path,
    faceTracking: row.face_tracking === 1,
    language: row.language,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    stages: JSON.parse(row.stages_json) as JobStages,
    error: row.error,
    result: row.result_json ? JSON.parse(row.result_json) as ClipsManifest : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class JobStore {
  constructor(private readonly db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        video_path TEXT NOT NULL,
        face_tracking INTEGER NOT NULL DEFAULT 0,
        language TEXT NOT NULL DEFAULT 'en',
        status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
        stage TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        stages_json TEXT NOT NULL,
        error TEXT,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs(created_at DESC);
    `);
    const columns = db.query("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "face_tracking")) {
      db.exec("ALTER TABLE jobs ADD COLUMN face_tracking INTEGER NOT NULL DEFAULT 0");
    }
    if (!columns.some((column) => column.name === "language")) {
      db.exec("ALTER TABLE jobs ADD COLUMN language TEXT NOT NULL DEFAULT 'en'");
    }
  }

  create(id: string, videoPath: string, faceTracking = false, language: ClipLanguage = "en"): Job {
    const now = new Date().toISOString();
    const stages = initialStages();
    this.db.query(`
      INSERT INTO jobs (id, video_path, face_tracking, language, status, stage, progress, stages_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', 'queued', 0, ?, ?, ?)
    `).run(id, videoPath, faceTracking ? 1 : 0, language, JSON.stringify(stages), now, now);
    return this.get(id)!;
  }

  get(id: string): Job | null {
    const row = this.db.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null;
    return row ? fromRow(row) : null;
  }

  list(limit = 50): Job[] {
    const rows = this.db.query(
      "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?",
    ).all(limit) as JobRow[];
    return rows.map(fromRow);
  }

  markRunning(id: string): void {
    this.update(id, "UPDATE jobs SET status='running', stage='starting', updated_at=? WHERE id=?", [
      new Date().toISOString(), id,
    ]);
  }

  requeue(id: string): void {
    this.update(id, `
      UPDATE jobs SET status='queued', stage='queued', progress=0, error=NULL, updated_at=? WHERE id=?
    `, [new Date().toISOString(), id]);
  }

  updateProgress(id: string, stage: PipelineStage, stageProgress: number): void {
    const job = this.get(id);
    if (!job) return;
    const clamped = Math.max(0, Math.min(100, Math.round(stageProgress)));
    const stageIndex = PIPELINE_STAGES.indexOf(stage);
    const stages = job.stages;
    for (const [index, name] of PIPELINE_STAGES.entries()) {
      if (index < stageIndex) stages[name] = { status: "completed", progress: 100 };
      else if (index === stageIndex) {
        stages[name] = { status: clamped === 100 ? "completed" : "running", progress: clamped };
      } else stages[name] = { status: "pending", progress: 0 };
    }
    const overall = Math.round(((stageIndex + clamped / 100) / PIPELINE_STAGES.length) * 100);
    this.update(id, `
      UPDATE jobs SET status='running', stage=?, progress=?, stages_json=?, updated_at=? WHERE id=?
    `, [stage, overall, JSON.stringify(stages), new Date().toISOString(), id]);
  }

  complete(id: string, result: ClipsManifest): void {
    const stages = Object.fromEntries(PIPELINE_STAGES.map((stage) => [
      stage,
      { status: "completed", progress: 100 },
    ])) as JobStages;
    this.update(id, `
      UPDATE jobs SET status='completed', stage='complete', progress=100, stages_json=?,
        result_json=?, error=NULL, updated_at=? WHERE id=?
    `, [JSON.stringify(stages), JSON.stringify(result), new Date().toISOString(), id]);
  }

  updateResult(id: string, result: ClipsManifest): void {
    this.update(id, "UPDATE jobs SET result_json=?, updated_at=? WHERE id=?", [
      JSON.stringify(result), new Date().toISOString(), id,
    ]);
  }

  fail(id: string, error: string): void {
    const job = this.get(id);
    if (!job) return;
    const stages = job.stages;
    const stage = PIPELINE_STAGES.find((name) => stages[name].status === "running");
    if (stage) stages[stage] = { ...stages[stage], status: "failed" };
    this.update(id, `
      UPDATE jobs SET status='failed', stage=?, stages_json=?, error=?, updated_at=? WHERE id=?
    `, [stage ?? job.stage, JSON.stringify(stages), error, new Date().toISOString(), id]);
  }

  private update(id: string, sql: string, values: SQLQueryBindings[]): void {
    this.db.query(sql).run(...values);
  }
}
