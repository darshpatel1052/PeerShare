import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Transform } from "node:stream";
import { randomUUID } from "node:crypto";

const stripped = new Set([
  "connection",
  "upgrade",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-user-id",
]);
export function proxyAPI(request, response, target, path = request.url) {
  const fail = (status, code, message) => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const id = randomUUID();
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Request-ID": id,
    });
    response.end(JSON.stringify({ code, message, request_id: id }));
  };
  if (!request.url.startsWith("/")) {
    fail(400, "invalid_target", "Use an application-relative request path.");
    return;
  }
  const uploadBody =
    request.method === "PUT" &&
    /^\/api\/v1\/uploads\/[a-f0-9-]{36}\/parts\/\d+$/.test(
      new URL(request.url, "http://localhost").pathname,
    );
  const completion =
    request.method === "POST" &&
    /^\/api\/v1\/uploads\/[a-f0-9-]{36}\/complete$/.test(
      new URL(request.url, "http://localhost").pathname,
    );
  const imageBody =
    request.method === "PUT" &&
    /^\/api\/v1\/(channels\/[a-f0-9-]{36}\/banner|videos\/[a-f0-9-]{36}\/thumbnail)$/.test(
      new URL(request.url, "http://localhost").pathname,
    );
  const maxBody = uploadBody
    ? 8 * 1024 * 1024
    : imageBody
      ? 5 * 1024 * 1024
      : 16 * 1024;
  if (Number(request.headers["content-length"] || 0) > maxBody) {
    fail(
      413,
      "body_too_large",
      uploadBody
        ? "Upload chunks cannot exceed 8 MiB."
        : imageBody
          ? "Choose an image under 5 MiB."
          : "The request body exceeds 16 KiB.",
    );
    request.resume();
    return;
  }
  const origin = new URL(target);
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([name]) => !stripped.has(name)),
  );
  headers.host = origin.host;
  const upstream = (origin.protocol === "https:" ? httpsRequest : httpRequest)(
    {
      hostname: origin.hostname,
      port: origin.port,
      path,
      method: request.method,
      headers,
    },
    (incoming) => {
      const returnedHeaders = Object.fromEntries(
        Object.entries(incoming.headers).filter(
          ([name]) => !stripped.has(name),
        ),
      );
      response.writeHead(incoming.statusCode || 502, returnedHeaders);
      incoming.pipe(response);
      incoming.on("error", () => response.destroy());
    },
  );
  upstream.setTimeout(uploadBody || completion ? 2 * 60_000 : 10_000, () =>
    upstream.destroy(new Error("upstream timeout")),
  );
  upstream.on("error", () =>
    fail(
      503,
      "api_unavailable",
      "The catalogue service is temporarily unavailable. Please retry.",
    ),
  );
  request.on("aborted", () => upstream.destroy());
  request.on("error", () => upstream.destroy());
  response.on("close", () => {
    if (!response.writableEnded) upstream.destroy();
  });
  let received = 0;
  const bounded = new Transform({
    transform(chunk, encoding, done) {
      received += chunk.length;
      if (received > maxBody) {
        fail(
          413,
          "body_too_large",
          uploadBody
            ? "Upload chunks cannot exceed 8 MiB."
            : imageBody
              ? "Choose an image under 5 MiB."
              : "The request body exceeds 16 KiB.",
        );
        upstream.destroy();
        done(new Error("request body limit"));
        return;
      }
      done(null, chunk);
    },
  });
  bounded.on("error", () => request.unpipe(bounded));
  request.pipe(bounded).pipe(upstream);
}
