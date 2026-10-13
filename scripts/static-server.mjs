import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { proxyAPI } from "./api-proxy.mjs";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
};

export function createStaticServer({
  webRoot,
  mediaRoot,
  allowedOrigin = "http://localhost:3000",
  apiTarget,
}) {
  return createServer(async (request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
    } catch {
      response.writeHead(400);
      response.end("Invalid path");
      return;
    }
    if (
      pathname.includes("\\") ||
      pathname.split("/").some((part) => part === ".." || part === ".")
    ) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
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
    if (
      apiTarget &&
      ((webRoot && pathname.startsWith("/media/videos/")) ||
        (!webRoot && pathname.startsWith("/videos/")))
    ) {
      const prefix = webRoot ? "/media/" : "/";
      const mediaPath = pathname.slice(prefix.length);
      proxyAPI(request, response, apiTarget, `/api/v1/media/${mediaPath}`);
      return;
    }
    if (
      apiTarget &&
      (pathname.startsWith("/api/v1/") || pathname.startsWith("/health/"))
    ) {
      proxyAPI(request, response, apiTarget);
      return;
    }
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD, OPTIONS" });
      response.end();
      return;
    }
    try {
      const path = pathname;
      const isMedia =
        path.startsWith("/media/") ||
        (!webRoot && path.startsWith("/fixture/"));
      // Media directories contain private drafts as well as public objects. Only the operator fixture bypasses API visibility.
      if (
        (isMedia || !webRoot) &&
        !(webRoot
          ? path.startsWith("/media/fixture/")
          : path.startsWith("/fixture/"))
      ) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
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
