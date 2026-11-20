import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type LlmSettingsInput = { baseUrl: string; apiKey?: string; model: string };
export type PublicLlmSettings = { baseUrl: string; model: string; configured: boolean };
type StoredLlmSettings = { baseUrl: string; apiKey: string; model: string };

export class LlmSettingsStore {
  private value: StoredLlmSettings;

  constructor(private readonly filePath = path.join("data", "llm-settings.json"), env: Record<string, string | undefined> = process.env) {
    this.value = {
      baseUrl: (env.LLM_BASE_URL ?? "http://192.168.1.9:20128/v1").replace(/\/$/, ""),
      apiKey: env.LLM_API_KEY ?? "",
      model: env.LLM_MODEL ?? "hermes-main",
    };
  }

  async load(): Promise<void> {
    try {
      const loaded = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<StoredLlmSettings>;
      if (typeof loaded.baseUrl === "string" && typeof loaded.apiKey === "string" && typeof loaded.model === "string") this.value = loaded as StoredLlmSettings;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    this.applyToProcess();
  }

  publicSettings(): PublicLlmSettings {
    return { baseUrl: this.value.baseUrl, model: this.value.model, configured: Boolean(this.value.apiKey) };
  }

  environment(): Record<string, string> {
    return { LLM_BASE_URL: this.value.baseUrl, LLM_API_KEY: this.value.apiKey, LLM_MODEL: this.value.model };
  }

  async update(input: LlmSettingsInput): Promise<PublicLlmSettings> {
    if (typeof input.baseUrl !== "string" || typeof input.model !== "string" || (input.apiKey !== undefined && typeof input.apiKey !== "string")) throw new Error("Enter a valid endpoint, model, and API key");
    let endpoint: URL;
    try { endpoint = new URL(input.baseUrl.trim()); }
    catch { throw new Error("Endpoint must be a valid URL, such as http://192.168.1.9:20128/v1"); }
    if (!(["http:", "https:"].includes(endpoint.protocol)) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("Endpoint must use HTTP or HTTPS and must not include credentials or query parameters");
    const model = input.model.trim();
    const apiKey = input.apiKey?.trim() || this.value.apiKey;
    if (!model) throw new Error("Model name is required");
    if (!apiKey) throw new Error("API key is required");
    this.value = { baseUrl: input.baseUrl.trim().replace(/\/$/, ""), model, apiKey };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(this.value), { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
    this.applyToProcess();
    return this.publicSettings();
  }

  async testConnection(): Promise<void> {
    if (!this.value.apiKey) throw new Error("Save an API key before testing the connection");
    let response: Response;
    try {
      response = await fetch(`${this.value.baseUrl}/models`, {
        headers: { authorization: `Bearer ${this.value.apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      throw new Error(`Cannot reach 9Router from the app server: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new Error(`9Router connection test returned HTTP ${response.status}`);
  }

  private applyToProcess(): void {
    process.env.LLM_BASE_URL = this.value.baseUrl;
    process.env.LLM_API_KEY = this.value.apiKey;
    process.env.LLM_MODEL = this.value.model;
  }
}
