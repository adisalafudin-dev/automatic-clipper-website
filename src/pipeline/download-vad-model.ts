import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_VAD_MODEL_FILE } from "./transcribe.ts";

const expectedSha256 = "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987";
const modelPath = process.env.WHISPER_VAD_MODEL_PATH ?? path.join(
  process.env.WHISPER_MODELS_DIR ?? path.join("tools", "whisper", "models"),
  DEFAULT_VAD_MODEL_FILE,
);
const modelUrl = "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin";

async function main(): Promise<void> {
  if (await Bun.file(modelPath).exists()) {
    const bytes = new Uint8Array(await Bun.file(modelPath).arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) {
      throw new Error(`Existing VAD model checksum mismatch: ${modelPath}`);
    }
    console.log(`VAD model already exists and is verified at ${modelPath}`);
    return;
  }
  const response = await fetch(modelUrl, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`VAD model download failed: HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 20_000_000) throw new Error("VAD model exceeds the 20 MB safety limit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 20_000_000) throw new Error("VAD model exceeds the 20 MB safety limit");
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) {
    throw new Error("VAD model download checksum mismatch");
  }
  await mkdir(path.dirname(modelPath), { recursive: true });
  await Bun.write(modelPath, bytes);
  console.log(`Downloaded and verified VAD model (${bytes.byteLength} bytes): ${modelPath}`);
}

main().catch((error: unknown) => {
  console.error(`VAD model setup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
