import type { JobListItem } from "../src/types.ts";

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
