import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { checkFfmpeg } from "./ffmpeg/check.ts";
import { createJobApi } from "./api.ts";
import { JobQueue } from "./state/queue.ts";
import { JobStore } from "./state/jobs.ts";
import appHtml from "../web/index.html";

async function main() {
  await checkFfmpeg();
  await mkdir("data", { recursive: true });
  const database = new Database(path.join("data", "jobs.sqlite"));
  database.exec("PRAGMA journal_mode = WAL;");
  const store = new JobStore(database);
  const queue = new JobQueue(store);
  const rawPort = Number(process.env.PORT ?? "3000");
  if (!Number.isInteger(rawPort) || rawPort < 0 || rawPort > 65_535) {
    throw new Error("PORT must be an integer from 0 to 65535");
  }
  const server = Bun.serve({
    hostname: process.env.HOST ?? "127.0.0.1",
    port: rawPort,
    maxRequestBodySize: 2_000_000_000,
    routes: { "/": appHtml },
    fetch: (request) => createJobApi(store, queue).fetch(request),
  });
  console.log(`Video Clipper API listening at http://${server.hostname}:${server.port}`);

  const shutdown = () => {
    server.stop();
    database.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
