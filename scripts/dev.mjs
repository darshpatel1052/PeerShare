import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createStaticServer } from "./static-server.mjs";
import { createTracker } from "../services/tracker/server.mjs";

try {
  await access(resolve(".local/media/fixture/integrity.json"));
} catch {
  console.error("Run npm run fixture first.");
  process.exit(1);
}
const media = createStaticServer({
  mediaRoot: resolve(".local/media"),
  allowedOrigin: "http://localhost:3000",
});
const tracker = createTracker();
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
      NEXT_PUBLIC_MEDIA_BASE_URL:
        process.env.NEXT_PUBLIC_MEDIA_BASE_URL ||
        "http://localhost:3001/fixture/",
    },
  },
);
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  web.kill("SIGTERM");
  media.close();
  media.closeAllConnections();
  tracker.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 3000).unref();
}
web.on("error", (error) => {
  console.error(error.message);
  close(1);
});
web.on("exit", (code) => close(code ?? 0));
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
