import path from "node:path";
import { randomUUID } from "node:crypto";
import { JobQueue } from "./state/queue.ts";
import { JobStore } from "./state/jobs.ts";

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createJobApi(store: JobStore, queue: JobQueue) {
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ status: "ok" });
      }

      if (url.pathname === "/jobs" && request.method === "POST") {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return json({ error: "Request body must be valid JSON" }, 400);
        }
        if (!isRecord(payload) || typeof payload.videoPath !== "string" || !payload.videoPath.trim()) {
          return json({ error: "videoPath must be a non-empty string" }, 400);
        }
        if (payload.force !== undefined && typeof payload.force !== "boolean") {
          return json({ error: "force must be a boolean" }, 400);
        }
        const videoPath = path.resolve(payload.videoPath.trim());
        if (!(await Bun.file(videoPath).exists())) {
          return json({ error: `Video not found: ${videoPath}` }, 400);
        }

        const id = randomUUID();
        const job = store.create(id, videoPath);
        queue.enqueue({ id, videoPath, force: payload.force === true });
        return json({ job }, 202, { location: `/jobs/${id}` });
      }

      if (url.pathname === "/jobs" && request.method === "GET") {
        const rawLimit = Number(url.searchParams.get("limit") ?? "50");
        const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 50;
        return json({ jobs: store.list(limit) });
      }

      const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/);
      if (jobMatch && request.method === "GET") {
        let id: string;
        try {
          id = decodeURIComponent(jobMatch[1]!);
        } catch {
          return json({ error: "Invalid job ID" }, 400);
        }
        const job = store.get(id);
        return job ? json({ job }) : json({ error: "Job not found" }, 404);
      }

      return json({ error: "Not found" }, 404);
    },
  };
}
