import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createStaticServer } from "./static-server.mjs";
import { createTracker } from "../services/tracker/server.mjs";

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
const allowedOrigin = `http://localhost:${port}`;
const web = createStaticServer({ webRoot, mediaRoot, allowedOrigin });
const media = createStaticServer({ mediaRoot, allowedOrigin });
const tracker = createTracker();
const listen = (server, listeningPort) =>
  new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(listeningPort, "127.0.0.1", accept);
  });
try {
  await listen(web, port);
  await listen(media, mediaPort);
  await new Promise((accept, reject) => {
    tracker.once("error", reject);
    tracker.listen(trackerPort, "127.0.0.1", accept);
  });
} catch (error) {
  console.error(error.message);
  web.close();
  media.close();
  tracker.close();
  process.exit(1);
}
console.log(`Production frontend: ${allowedOrigin}`);
console.log(`Media origin: http://localhost:${mediaPort}/fixture/master.m3u8`);
console.log(`Compatible tracker: ws://localhost:${trackerPort}`);
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  web.close();
  web.closeAllConnections();
  media.close();
  media.closeAllConnections();
  tracker.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
