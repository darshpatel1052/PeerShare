import { mkdir, writeFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  execute,
  hostCommand,
  hostTarget,
  sshOptions,
} from "./benchmark/host.mjs";

const operation = process.argv[2] || "open";
const socket = resolve(".local/aws/operations-tunnel.sock");
const settings = resolve(".local/aws/operations.env");
const ports = [3301, 19095, 16686];
if (!["open", "close", "status"].includes(operation))
  throw new Error("Use open, close or status");
const target = await hostTarget();

async function connected() {
  try {
    await execute("ssh", [...sshOptions, "-S", socket, "-O", "check", target]);
    return true;
  } catch {
    return false;
  }
}

if (operation === "close") {
  if (await connected())
    await execute("ssh", [...sshOptions, "-S", socket, "-O", "exit", target]);
  console.log("Cloud monitoring tunnel closed; AWS services keep running.");
} else if (operation === "status") {
  console.log(
    (await connected())
      ? "Cloud monitoring tunnel is open."
      : "Cloud monitoring tunnel is closed.",
  );
} else {
  await mkdir(resolve(".local/aws"), { recursive: true, mode: 0o700 });
  const value = await hostCommand("sudo cat /srv/peerscreen/operations.env", {
    timeout: 20000,
  });
  if (!/^GRAFANA_ADMIN_PASSWORD=[a-f0-9]{48}\n?$/.test(value))
    throw new Error("Cloud monitoring settings are unavailable or invalid");
  await writeFile(settings, value, { mode: 0o600 });
  await chmod(settings, 0o600);
  if (!(await connected())) {
    const args = [
      ...sshOptions,
      "-M",
      "-S",
      socket,
      "-fNT",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=30",
      "-o",
      "ServerAliveCountMax=3",
      ...ports.flatMap((port) => ["-L", `127.0.0.1:${port}:127.0.0.1:${port}`]),
      target,
    ];
    // The background SSH master must not retain Node's output pipes.
    await new Promise((accept, reject) => {
      const child = spawn("ssh", args, { stdio: "ignore" });
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Cloud monitoring tunnel timed out"));
      }, 30000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        code === 0
          ? accept()
          : reject(
              new Error(
                "Could not open the private tunnel; check SSH access and local ports",
              ),
            );
      });
    });
  }
  for (const [port, path] of [
    [3301, "/api/health"],
    [19095, "/-/ready"],
    [16686, "/"],
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(10000),
    });
    await response.arrayBuffer();
    if (!response.ok)
      throw new Error(`Cloud monitoring on port ${port} is not ready`);
  }
  console.log(
    "AWS monitoring: Grafana http://localhost:3301/d/peerscreen-operations · Prometheus http://localhost:19095 · Jaeger http://localhost:16686",
  );
  console.log(
    "Grafana username: admin. Its cloud password is in .local/aws/operations.env.",
  );
}
