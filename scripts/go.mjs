import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { localEnvironment } from "./local-environment.mjs";

export async function goBinary() {
  if (process.env.PEERSCREEN_GO) return process.env.PEERSCREEN_GO;
  // Snap's wrapper cannot run in some restricted development shells; its compiler can.
  try {
    await access("/snap/go/current/bin/go");
    return "/snap/go/current/bin/go";
  } catch {
    return "go";
  }
}
export async function runGo(
  args,
  environment = process.env,
  { json = false } = {},
) {
  const env = {
    ...environment,
    GOTOOLCHAIN: "go1.27.2",
    GOCACHE: process.env.GOCACHE || resolve(".local/gocache"),
    GOMODCACHE: process.env.GOMODCACHE || resolve(".local/gomodcache"),
  };
  return await new Promise(async (accept, reject) => {
    const child = spawn(await goBinary(), args, {
      cwd: resolve("services/api"),
      env,
      stdio: json ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    if (json)
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) accept(output);
      else {
        const error = new Error(`Go command failed with exit code ${code}`);
        error.output = output;
        reject(error);
      }
    });
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const operation = process.argv[2] || "test";
  try {
    if (operation === "build") {
      await mkdir(resolve(".local/bin"), { recursive: true });
      await runGo([
        "build",
        "-o",
        resolve(".local/bin/peerscreen"),
        "./cmd/peerscreen",
      ]);
    } else if (operation === "migrate" || operation === "seed-fixture") {
      const env = await localEnvironment();
      await runGo(
        [
          "run",
          "./cmd/peerscreen",
          operation,
          ...(operation === "seed-fixture"
            ? [resolve(".local/media/fixture/fixture.json")]
            : []),
        ],
        env,
      );
    } else if (operation === "format") await runGo(["fmt", "./..."]);
    else if (operation === "test") await runGo(["test", "-race", "./..."]);
    else if (operation === "vet") await runGo(["vet", "./..."]);
    else throw new Error("Unsupported Go operation");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
