/**
 * Serves `dist/` with nginx.conf's routing, for checking a production build
 * locally — `vite preview` falls back to index.html and so can't show whether
 * the prerendered pages and the app.html fallback resolve the way they will in
 * the container.
 *
 * Mirrors `try_files $uri $uri/ /app.html`.
 *
 *   node scripts/serve-dist.mjs [port]
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.argv[2] ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** try_files $uri $uri/ /app.html */
async function resolveFile(urlPath) {
  // normalize() collapses `..` so a request can't escape dist/
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  const direct = join(dist, rel);
  if (!direct.startsWith(dist)) return join(dist, "app.html");

  if (rel && (await isFile(direct))) return direct;

  const asDir = join(direct, "index.html");
  if (await isFile(asDir)) return asDir;

  return join(dist, "app.html");
}

createServer(async (req, res) => {
  const urlPath = new URL(req.url, "http://localhost").pathname;

  // In the container Traefik routes /api to the API service and nginx never
  // sees it. Answering it here with the SPA fallback would hand the auth
  // client an HTML body to parse as JSON, so it 404s instead: this harness
  // serves static files only.
  if (urlPath.startsWith("/api/")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"no API in scripts/serve-dist.mjs"}');
    return;
  }

  const file = await resolveFile(urlPath);

  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(port, () => {
  console.log(`serving dist/ (nginx try_files rules) on http://localhost:${port}`);
});
