import { expect, test } from "bun:test";
import { uiResponse } from "./ui.ts";

test("local UI serves its workspace page and frontend assets", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => (await uiResponse(request)) ?? new Response("missing", { status: 404 }),
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const page = await fetch(baseUrl);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("Drop your video here");

    const script = await fetch(`${baseUrl}/app.js`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("saveEdit");

    expect((await fetch(`${baseUrl}/anything-else`)).status).toBe(404);
  } finally {
    server.stop?.();
  }
});
