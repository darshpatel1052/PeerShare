import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
export const sshOptions = [
  "-i",
  resolve(".local/aws/ssh/id_ed25519"),
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "UserKnownHostsFile=" + resolve(".local/aws/ssh/known_hosts"),
  "-o",
  "ConnectTimeout=10",
  "-o",
  "BatchMode=yes",
];
export async function hostTarget() {
  const o = JSON.parse(
    await readFile(".local/aws/terraform/terraform.tfstate", "utf8"),
  ).outputs;
  const ip = o.public_ip.value;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip))
    throw Error("Invalid deployment address");
  return "ubuntu@" + ip;
}
export async function execute(binary, args, input, { timeout = 120000 } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.stdout.on("data", (x) => (stdout += x));
    child.stderr.on("data", (x) => (stderr += x));
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) accept(stdout);
      else {
        const e = Error("Private operator command failed");
        e.stderr = stderr;
        reject(e);
      }
    });
    child.stdin.end(input);
  });
}
export async function hostCommand(script, options) {
  return execute(
    "ssh",
    [...sshOptions, await hostTarget(), "bash -s"],
    "set -euo pipefail\n" + script,
    options,
  );
}
export async function sql(
  script,
  { local = false, database = "peerscreen" } = {},
) {
  if (!/^peerscreen(?:_benchmark)?$/.test(database))
    throw Error("Invalid project database");
  const args = [
    "exec",
    "-i",
    "peerscreen-postgres-1",
    "psql",
    "-X",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "peerscreen_admin",
    "-d",
    database,
  ];
  if (local) return execute("docker", args, script);
  return hostCommand(
    `sudo docker ${args.join(" ")} <<'PEERSCREEN_SQL'\n${script}\nPEERSCREEN_SQL\n`,
  );
}
export async function privateError(name, error) {
  await mkdir(".local/benchmark", { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(".local/benchmark", name),
    String(error.stderr || error.stack || error),
    { mode: 0o600 },
  );
  console.error(
    "Operation stopped. Details are in the ignored private benchmark directory.",
  );
  process.exitCode = 1;
}
