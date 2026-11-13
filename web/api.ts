import type { ClipLanguage, JobListItem, JobView, UiClipEdit, UiSentence } from "../src/types.ts";
import type { ModeName, ModeProfile } from "../src/modes.ts";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error) message = body.error;
    } catch { /* The response may not be JSON. */ }
    throw new Error(message);
  }
  return await response.json() as T;
}

export async function getJobs(): Promise<JobListItem[]> {
  const result = await request<{ jobs: JobListItem[] }>("/jobs");
  return result.jobs;
}

export async function getModes(): Promise<ModeProfile[]> {
  return await request<ModeProfile[]>("/modes");
}

export async function uploadVideo(file: File, faceTracking: boolean, language: ClipLanguage, mode: ModeName, facecamRect?: string, displayName?: string): Promise<JobView> {
  const form = new FormData();
  form.set("video", file);
  form.set("faceTracking", String(faceTracking));
  form.set("language", language);
  form.set("mode", mode);
  if (facecamRect) form.set("facecamRect", facecamRect);
  if (displayName) form.set("displayName", displayName);
  const result = await request<{ job: JobView }>("/jobs", { method: "POST", body: form });
  return result.job;
}

export async function getJob(id: string): Promise<{ job: JobView; edits: Record<string, UiClipEdit> }> {
  return await request(`/jobs/${encodeURIComponent(id)}`);
}

export async function getTranscript(id: string): Promise<UiSentence[]> {
  const result = await request<{ sentences: UiSentence[] }>(`/jobs/${encodeURIComponent(id)}/transcript`);
  return result.sentences;
}

export async function saveClipEdit(jobId: string, clipId: string, payload: Record<string, unknown>): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
}

export async function renderClip(jobId: string, clipId: string): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}/render`, { method: "POST" });
}

export async function renderStale(jobId: string): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/render`, { method: "POST" });
}

export async function cancelJob(jobId: string): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
}

export async function retryJob(jobId: string): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" });
}

export async function removeClip(jobId: string, clipId: string): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}`, { method: "DELETE" });
}

export async function createClip(jobId: string, startMs: number, endMs: number): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/clips`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startMs, endMs }),
  });
}
