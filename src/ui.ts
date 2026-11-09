import path from "node:path";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

export async function uiResponse(request: Request): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const pathname = new URL(request.url).pathname;
  const filename = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  if (!new Set(["index.html", "app.js", "styles.css"]).has(filename)) return null;
  const filePath = path.join(import.meta.dir, "..", "web", filename);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return new Response("UI asset not found", { status: 404 });
  return new Response(file, {
    headers: {
      "content-type": contentTypes[path.extname(filename)]!,
      "cache-control": "no-store, max-age=0",
    },
  });
}
