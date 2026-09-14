// Static file server for index.html, the built bundle and the CSV.
import { join, normalize } from "node:path";

const root = join(import.meta.dir, "..");
const port = Number(process.env.PORT) || 3000;

Bun.serve({
  port,
  async fetch(req) {
    let path = decodeURIComponent(new URL(req.url).pathname);
    if (path.endsWith("/")) path += "index.html";
    const filePath = normalize(join(root, path));
    if (!filePath.startsWith(root)) return new Response("Forbidden", { status: 403 });
    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    // Never cache locally, so CSV edits show on reload.
    return new Response(file, { headers: { "Cache-Control": "no-store" } });
  },
});

console.log(`futuremeds-map dev server: http://localhost:${port}/`);
