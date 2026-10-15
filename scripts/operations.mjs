import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { compose } from "./dependencies.mjs";
import { startContainerApp } from "./compose-demo.mjs";

const file = ".local/operations.env";
await mkdir(".local", { recursive: true, mode: 0o700 });
try {
  await readFile(file);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  await writeFile(
    file,
    "GRAFANA_ADMIN_PASSWORD=" + randomBytes(24).toString("hex") + "\n",
    { mode: 0o600, flag: "wx" },
  );
}
if ((await stat(file)).mode & 0o077)
  throw new Error("Private operator settings require mode 0600");
const value = (await readFile(file, "utf8"))
  .trim()
  .match(/^GRAFANA_ADMIN_PASSWORD=([a-f0-9]{48})$/);
if (!value) throw new Error("Invalid private operator settings");
process.env.GRAFANA_ADMIN_PASSWORD = value[1];
process.env.PEERSCREEN_WITH_OPERATIONS = "true";
const options = { overlays: ["deploy/compose/operations.yml"] };
if ((process.argv[2] || "up") === "up") {
  await compose(
    ["up", "-d", "--no-build", "prometheus", "grafana", "jaeger"],
    options,
  );
  await startContainerApp(options);
  console.log(
    "PeerShare: http://localhost:3000. Grafana: http://localhost:3301. Jaeger: http://localhost:16686. Operator username: admin; password remains in .local/operations.env.",
  );
} else if (process.argv[2] === "stop") {
  await compose(["stop", "prometheus", "grafana", "jaeger"], options);
  console.log(
    "Operator services stopped; their saved data and the application remain.",
  );
} else throw new Error("Use up or stop");
