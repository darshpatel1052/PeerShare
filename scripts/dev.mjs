import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createStaticServer } from "./static-server.mjs";
import { createTracker } from "../services/tracker/server.mjs";
import { startBackend } from "./backend.mjs";

try {
  await access(resolve(".local/media/fixture/integrity.json"));
} catch {
  console.error("Run npm run fixture first.");
  process.exit(1);
}
const tracker = createTracker();
const backend = await startBackend({
  origin: "http://localhost:3000",
  trackerUrl: "ws://localhost:8000",
  mediaBase: "http://localhost:3000/media/",
});
const media = createStaticServer({
  mediaRoot: resolve(".local/media"),
  allowedOrigin: "http://localhost:3000",
  apiTarget: backend.target,
});
const listen = (server, port) =>
  new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", accept);
  });
try {
  await listen(media, 3001);
  await new Promise((accept, reject) => {
    tracker.once("error", reject);
    tracker.listen(8000, "127.0.0.1", accept);
  });
} catch (error) {
  console.error(error.message);
  media.close();
  tracker.close();
  await backend.close();
  process.exit(1);
}
const web = spawn(
  process.execPath,
  [
    resolve("node_modules/next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3000",
  ],
  {
    cwd: resolve("apps/web"),
    stdio: "inherit",
    env: {
      ...process.env,
      PEERSCREEN_DEV_PROXY: "true",
      API_TARGET: backend.target,
    },
  },
);
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  web.kill("SIGTERM");
  media.close();
  media.closeAllConnections();
  for (const client of tracker.ws?.clients || []) client.terminate();
  tracker.close();
  tracker.http?.closeAllConnections();
  setTimeout(() => process.exit(1), 15_000).unref();
  await backend.close();
  process.exit(code);
}
web.on("error", (error) => {
  console.error(error.message);
  close(1);
});
web.on("exit", (code) => close(code ?? 0));
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
