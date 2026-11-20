import type { ClipFeedback, ClipFeedbackDecision, ClipFeedbackReason, ClipLanguage, JobListItem, JobView, UiClipEdit, UiSentence } from "../src/types.ts";
import type { ModeName, ModeProfile } from "../src/modes.ts";

export type LlmSettings = { baseUrl: string; model: string; configured: boolean };
export type YouTubeAnalysisCandidate = { id: string; title: string; hook: string; reason: string; score: number; start: number; end: number; signalScores?: { model: number; chat: number; heatmap: number } };
export type YouTubeAnalysisView = {
  id: string; status: "running" | "completed" | "creating" | "failed" | "cancelled"; stage: string; progress: number;
  error?: string; projectId?: string;
  result?: { videoId: string; title: string; duration: number; channel: string; language: string; candidates: YouTubeAnalysisCandidate[]; warnings: string[]; signals: { windows: Array<{ start: number; end: number; chatScore: number; heatmapScore: number; chatCount: number; samples: string[] }>; chapters: Array<{ start: number; end: number; title: string }> } };
};

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

export async function getLlmSettings(): Promise<LlmSettings> {
  return await request<LlmSettings>("/settings/llm");
}

export async function saveLlmSettings(input: { baseUrl: string; apiKey?: string; model: string }): Promise<LlmSettings> {
  const result = await request<{ settings: LlmSettings }>("/settings/llm", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
  return result.settings;
}

export async function testLlmConnection(): Promise<void> {
  await request<{ ok: true }>("/settings/llm/test", { method: "POST" });
}

export async function startYouTubeAnalysis(url: string): Promise<YouTubeAnalysisView> {
  const result = await request<{ job: YouTubeAnalysisView }>("/youtube-analysis", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
  });
  return result.job;
}

export async function getYouTubeAnalysis(id: string): Promise<YouTubeAnalysisView> {
  const result = await request<{ job: YouTubeAnalysisView }>(`/youtube-analysis/${encodeURIComponent(id)}`);
  return result.job;
}

export async function createYouTubeProject(id: string, settings: { candidateIds: string[]; mode: ModeName; faceTracking: boolean; captionsEnabled: boolean; facecamRect?: string }): Promise<YouTubeAnalysisView> {
  const result = await request<{ job: YouTubeAnalysisView }>(`/youtube-analysis/${encodeURIComponent(id)}/create-project`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(settings),
  });
  return result.job;
}

export async function cancelYouTubeAnalysis(id: string): Promise<void> {
  await request(`/youtube-analysis/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function uploadVideo(file: File, faceTracking: boolean, language: ClipLanguage, mode: ModeName, facecamRect?: string, displayName?: string, captionsEnabled = true, onProgress?: (percentage: number) => void): Promise<JobView> {
  return await new Promise<JobView>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/jobs");
    xhr.setRequestHeader("x-video-filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("x-face-tracking", String(faceTracking));
    xhr.setRequestHeader("x-captions-enabled", String(captionsEnabled));
    xhr.setRequestHeader("x-language", language);
    xhr.setRequestHeader("x-mode", mode);
    if (facecamRect) xhr.setRequestHeader("x-facecam-rect", facecamRect);
    if (displayName) xhr.setRequestHeader("x-project-name", encodeURIComponent(displayName));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.min(99, Math.round(event.loaded / event.total * 100)));
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload was cancelled."));
    xhr.onload = () => {
      let body: { job?: JobView; error?: string };
      try { body = JSON.parse(xhr.responseText) as { job?: JobView; error?: string }; }
      catch { reject(new Error(`Upload failed (${xhr.status}). The server returned an invalid response.`)); return; }
      if (xhr.status < 200 || xhr.status >= 300 || !body.job) {
        reject(new Error(body.error ?? `Upload failed (${xhr.status}).`));
        return;
      }
      onProgress?.(100);
      resolve(body.job);
    };
    xhr.send(file);
  });
}

export async function getJob(id: string): Promise<{ job: JobView; edits: Record<string, UiClipEdit>; feedback: Record<string, ClipFeedback> }> {
  return await request(`/jobs/${encodeURIComponent(id)}`);
}

export async function saveClipFeedback(jobId: string, clipId: string, decision: ClipFeedbackDecision, reason?: ClipFeedbackReason): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}/feedback`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
  });
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

export async function renderClip(jobId: string, clipId: string, settings?: { mode: ModeName; faceTracking: boolean; captionsEnabled: boolean; facecamRect?: string | null }): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}/render`, {
    method: "POST",
    ...(settings ? { headers: { "content-type": "application/json" }, body: JSON.stringify(settings) } : {}),
  });
}

export async function renderStale(jobId: string, settings?: { mode: ModeName; faceTracking: boolean; captionsEnabled: boolean; facecamRect?: string | null }): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/render`, {
    method: "POST",
    ...(settings ? { headers: { "content-type": "application/json" }, body: JSON.stringify(settings) } : {}),
  });
}

export async function cancelJob(jobId: string): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
}

export async function deleteJob(jobId: string): Promise<void> {
  await request(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
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
