export interface JsonGenerator {
  generateJson(prompt: string, schema: string): Promise<unknown>;
}

type CompletionResponse = {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class RouterClient implements JsonGenerator {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  readonly responseModels = new Set<string>();

  constructor(env: Record<string, string | undefined> = process.env) {
    this.baseUrl = (env.LLM_BASE_URL ?? "http://localhost:20128/v1").replace(/\/$/, "");
    this.apiKey = env.LLM_API_KEY ?? "";
    this.model = env.LLM_MODEL ?? "hermes-main";
    if (!this.apiKey) throw new Error("LLM_API_KEY is required; set it in .env or the environment");
  }

  async generateJson(prompt: string, schema: string): Promise<unknown> {
    const body = {
      model: this.model,
      temperature: 0.2,
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `Return only valid JSON matching this schema: ${schema}` },
        { role: "user", content: prompt },
      ],
    };

    for (let attempt = 0; attempt < 4; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        throw new Error(`9Router request failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (response.status === 429 && attempt < 3) {
        await wait(500 * 2 ** attempt);
        continue;
      }
      const payload = (await response.json().catch(() => ({}))) as CompletionResponse;
      if (!response.ok) {
        throw new Error(`9Router returned HTTP ${response.status}: ${payload.error?.message ?? "request failed"}`);
      }
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("9Router response did not contain message content");
      if (payload.model) {
        this.responseModels.add(payload.model);
        console.log(`LLM responded with model: ${payload.model}`);
      }
      try {
        return JSON.parse(content) as unknown;
      } catch {
        throw new Error("9Router returned invalid JSON content");
      }
    }
    throw new Error("9Router rate limit retries exhausted");
  }
}
