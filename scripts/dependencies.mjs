import { spawn } from "node:child_process";
import { localEnvironment } from "./local-environment.mjs";

export async function compose(args, { test = false, quiet = false } = {}) {
  const environment = await localEnvironment({ test });
  const name = test ? "peerscreen-test" : "peerscreen";
  return await new Promise((accept, reject) => {
    const child = spawn(
      "docker",
      [
        "compose",
        "--project-name",
        name,
        "--env-file",
        ".local/local.env",
        "-f",
        "deploy/compose/local.yml",
        ...args,
      ],
      {
        env: environment,
        stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
      },
    );
    let output = "";
    if (quiet) {
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", () => {});
    }
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? accept(output)
        : reject(new Error(`Local Compose command failed (${code})`)),
    );
  });
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const operation = process.argv[2] || "up";
    if (operation === "up")
      await compose(["up", "-d", "--wait", "--wait-timeout", "60"]);
    else if (operation === "stop") await compose(["stop"]);
    else
      throw new Error(
        "Use up or stop; persistent data is not removed by these commands",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
