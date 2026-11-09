import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { YUNET_MODEL_FILE, YUNET_MODEL_URL } from "./faces.ts";

const expectedSha256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
const modelPath = process.env.FACE_MODEL_PATH ?? path.join("data", "models", YUNET_MODEL_FILE);

async function main() {
  if (await Bun.file(modelPath).exists()) {
    const existing = new Uint8Array(await Bun.file(modelPath).arrayBuffer());
    const existingSha256 = createHash("sha256").update(existing).digest("hex");
    if (existingSha256 !== expectedSha256) throw new Error(`Existing model checksum mismatch: ${modelPath}`);
    console.log(`YuNet model already exists and is verified at ${modelPath}`);
    return;
  }
  const response = await fetch(YUNET_MODEL_URL, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`YuNet download failed: HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 20_000_000) throw new Error("YuNet download exceeds the 20 MB safety limit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 20_000_000) throw new Error("YuNet download exceeds the 20 MB safety limit");
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) throw new Error("YuNet download checksum mismatch");
  await mkdir(path.dirname(modelPath), { recursive: true });
  await Bun.write(modelPath, bytes);
  console.log(`Downloaded and verified YuNet CPU model (${bytes.byteLength} bytes): ${modelPath}`);
}

main().catch((error) => {
  console.error(`Face model download failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
