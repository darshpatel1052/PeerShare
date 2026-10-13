import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { compose } from "./dependencies.mjs";
import { localEnvironment } from "./local-environment.mjs";
import { runGo } from "./go.mjs";

function command(binary, args, env) {
  return new Promise((accept, reject) => {
    const child = spawn(binary, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? accept() : reject(new Error("Backend setup command failed")),
    );
  });
}

export async function startBackend({
  origin,
  trackerUrl,
  mediaBase,
  listen = "127.0.0.1:18080",
  storageRoot,
}) {
  if (process.env.API_TARGET)
    return { target: process.env.API_TARGET, close: async () => {} };
  const test = process.env.PEERSCREEN_TEST_RUNTIME === "true";
  await compose(["up", "-d", "--wait", "--wait-timeout", "60"], {
    test,
    quiet: true,
  });
  const storage =
    storageRoot ||
    (test
      ? await mkdtemp(join(tmpdir(), "peerscreen-runtime-"))
      : resolve(".local"));
  const env = {
    ...(await localEnvironment({ test })),
    APP_ORIGIN: origin,
    TRACKER_URL: trackerUrl,
    MEDIA_BASE_URL: process.env.MEDIA_BASE_URL || mediaBase,
    API_LISTEN_ADDR: listen,
    UPLOAD_DIR: join(storage, "uploads"),
    MEDIA_DIR: test ? join(storage, "media") : resolve(".local/media"),
  };
  // The API needs its own database/cache credentials, not the administrator's password.
  delete env.POSTGRES_PASSWORD;
  delete env.CATALOG_DB_PASSWORD;
  delete env.REDIS_PASSWORD;
  const binary = resolve(".local/bin/peerscreen");
  await mkdir(resolve(".local/bin"), { recursive: true });
  await runGo(["build", "-o", binary, "./cmd/peerscreen"]);
  await command(binary, ["migrate"], env);
  await command(
    binary,
    ["seed-fixture", resolve(".local/media/fixture/fixture.json")],
    env,
  );
  const child = spawn(binary, ["serve"], { env, stdio: "inherit" });
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  const target = `http://${listen}`;
  try {
    const deadline = Date.now() + 15_000;
    let ready = false;
    while (Date.now() < deadline && !exited) {
      try {
        const response = await fetch(`${target}/health/ready`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((accept) => setTimeout(accept, 200));
    }
    if (!ready) throw new Error("The catalogue API did not become ready");
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
  let stopped = false;
  let cleaned = false;
  const stopProcess = async () => {
    if (stopped) return;
    stopped = true;
    if (!exited) {
      child.kill("SIGTERM");
      await new Promise((accept) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          accept();
        }, 12_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          accept();
        });
      });
    }
  };
  return {
    target,
    storage,
    pid: child.pid,
    stopProcess,
    close: async () => {
      await stopProcess();
      if (test && !cleaned) {
        cleaned = true;
        await compose(["down", "--volumes"], { test: true, quiet: true });
        await rm(storage, { recursive: true, force: true });
      }
    },
  };
}
