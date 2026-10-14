import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createStaticServer } from "./static-server.mjs";
import { createTracker } from "../services/tracker/server.mjs";
import { startBackend } from "./backend.mjs";

const webRoot = resolve("apps/web/out");
const mediaRoot = resolve(".local/media");
try {
  await access(resolve(webRoot, "index.html"));
  await access(resolve(mediaRoot, "fixture/integrity.json"));
} catch {
  console.error("Run npm run fixture and npm run web-build before the demo.");
  process.exit(1);
}
const port = Number(process.env.DEMO_PORT || 3000);
const mediaPort = Number(process.env.MEDIA_PORT || 3001);
const trackerPort = Number(process.env.TRACKER_PORT || 8000);
const allowedOrigin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const bindHost = process.env.DEMO_BIND_HOST || "127.0.0.1";
const backend = await startBackend({
  origin: allowedOrigin,
  trackerUrl: `ws://localhost:${trackerPort}`,
  mediaBase: `${allowedOrigin}/media/`,
  listen: process.env.API_LISTEN_ADDR || "127.0.0.1:18080",
});
const web = createStaticServer({
  webRoot,
  mediaRoot,
  allowedOrigin,
  apiTarget: backend.target,
});
const media = createStaticServer({
  mediaRoot,
  allowedOrigin,
  apiTarget: backend.target,
});
const tracker = createTracker({ allowedOrigins: [allowedOrigin] });
const listen = (server, listeningPort) =>
  new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(listeningPort, bindHost, accept);
  });
try {
  await listen(web, port);
  await listen(media, mediaPort);
  await new Promise((accept, reject) => {
    tracker.once("error", reject);
    tracker.listen(trackerPort, bindHost, accept);
  });
} catch (error) {
  console.error(error.message);
  web.close();
  media.close();
  tracker.close();
  await backend.close();
  process.exit(1);
}
console.log(`Production frontend: ${allowedOrigin}`);
console.log(`Media origin: http://localhost:${mediaPort}/fixture/master.m3u8`);
console.log(`Compatible tracker: ws://localhost:${trackerPort}`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  web.close();
  web.closeAllConnections();
  media.close();
  media.closeAllConnections();
  for (const client of tracker.ws?.clients || []) client.terminate();
  tracker.close();
  tracker.http?.closeAllConnections();
  setTimeout(() => process.exit(1), 15_000).unref();
  await backend.close();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
