import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export function createStaticServer({
  webRoot,
  mediaRoot,
  allowedOrigin = "http://localhost:3000",
}) {
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    const origin = request.headers.origin;
    if (origin === allowedOrigin) {
      response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    }
    response.setHeader("Vary", "Origin");
    if (request.method === "OPTIONS") {
      response.writeHead(origin === allowedOrigin ? 204 : 403);
      response.end();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD, OPTIONS" });
      response.end();
      return;
    }
    try {
      const url = new URL(request.url, "http://localhost");
      const path = decodeURIComponent(url.pathname);
      const isMedia =
        path.startsWith("/media/") ||
        (!webRoot && path.startsWith("/fixture/"));
      const root = resolve(isMedia ? mediaRoot : (webRoot ?? mediaRoot));
      const relative =
        isMedia && webRoot ? path.slice("/media/".length) : path.slice(1);
      let file = resolve(root, relative);
      if (!file.startsWith(root + sep) && file !== root) {
        response.writeHead(403);
        response.end();
        return;
      }
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
      const realRoot = await realpath(root);
      file = await realpath(file);
      if (!file.startsWith(realRoot + sep)) {
        response.writeHead(403);
        response.end();
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) throw new Error("Not a file");
      response.writeHead(200, {
        "Content-Type": mimeTypes[extname(file)] ?? "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": "no-store",
      });
      if (request.method === "HEAD") response.end();
      else
        createReadStream(file)
          .on("error", () => response.destroy())
          .pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end("Not found");
    }
  });
}
