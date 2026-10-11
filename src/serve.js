#!/usr/bin/env node
// Local preview of a built site: npm run serve [-- DIR]   (default ./dist, http://localhost:8080)
// For production, copy the built folder to the internal web server instead.
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".woff2": "font/woff2", ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".mp3": "audio/mpeg",
};

const dir = path.resolve(process.argv[2] || "dist");
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || "127.0.0.1";

http.createServer(async (req, res) => {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(dir, rel);
  if (file !== dir && !file.startsWith(dir + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}).listen(port, host, () => {
  console.log(`Serving ${dir} at http://${host === "127.0.0.1" ? "localhost" : host}:${port}/`);
});
