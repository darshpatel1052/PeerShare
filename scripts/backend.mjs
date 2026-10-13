import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createConnection } from "node:net";
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

function managedProcess(binary, env) {
  const child = spawn(binary, ["serve"], { env, stdio: "inherit" });
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  child.on("error", () => {
    exited = true;
  });
  return {
    child,
    get exited() {
      return exited;
    },
    async stop(signal = "SIGTERM") {
      if (exited) return;
      child.kill(signal);
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
    },
  };
}
async function waitForMedia(port, process) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !process.exited) {
    const listening = await new Promise((accept) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(500);
      socket.once("connect", () => {
        socket.destroy();
        accept(true);
      });
      socket.once("error", () => {
        socket.destroy();
        accept(false);
      });
      socket.once("timeout", () => {
        socket.destroy();
        accept(false);
      });
    });
    if (listening) return;
    await new Promise((accept) => setTimeout(accept, 100));
  }
  throw new Error("The media coordinator did not become ready");
}

export async function startBackend({
  origin,
  trackerUrl,
  mediaBase,
  listen = "127.0.0.1:18080",
  storageRoot,
  legacy = false,
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
  const base = await localEnvironment({ test });
  const mediaPort = test ? 19091 : 19090;
  const env = {
    ...base,
    APP_ORIGIN: origin,
    TRACKER_URL: trackerUrl,
    MEDIA_BASE_URL: process.env.MEDIA_BASE_URL || mediaBase,
    API_LISTEN_ADDR: listen,
    UPLOAD_DIR: join(storage, "uploads"),
    MEDIA_DIR: test ? join(storage, "media") : resolve(".local/media"),
    MEDIA_GRPC_ADDR: legacy ? "" : `127.0.0.1:${mediaPort}`,
  };
  // The API needs its own database/cache credentials, not the administrator's password.
  delete env.POSTGRES_PASSWORD;
  delete env.CATALOG_DB_PASSWORD;
  delete env.REDIS_PASSWORD;
  delete env.MEDIA_DB_PASSWORD;
  delete env.MEDIA_DATABASE_URL;
  delete env.WORKER_RPC_TOKEN;
  const binary = resolve(".local/bin/peerscreen");
  await mkdir(resolve(".local/bin"), { recursive: true });
  await runGo(["build", "-o", binary, "./cmd/peerscreen"]);
  await command(binary, ["migrate"], env);
  await command(
    binary,
    ["seed-fixture", resolve(".local/media/fixture/fixture.json")],
    env,
  );
  let coordinator;
  let worker;
  const mediaBinary = resolve(".local/bin/media");
  const workerBinary = resolve(".local/bin/worker");
  const serviceBase = Object.fromEntries(
    Object.entries({
      PATH: base.PATH,
      LANG: base.LANG,
      APP_ENV: "development",
      KAFKA_BOOTSTRAP_SERVERS: base.KAFKA_BOOTSTRAP_SERVERS,
      MEDIA_DIR: env.MEDIA_DIR,
    }).filter(([, value]) => value !== undefined),
  );
  const mediaEnv = {
    ...serviceBase,
    MEDIA_DATABASE_URL: base.MEDIA_DATABASE_URL,
    MEDIA_LISTEN_ADDR: `127.0.0.1:${mediaPort}`,
    CATALOG_RPC_TOKEN: base.CATALOG_RPC_TOKEN,
    WORKER_RPC_TOKEN: base.WORKER_RPC_TOKEN,
  };
  const workerEnv = {
    ...serviceBase,
    MEDIA_GRPC_ADDR: env.MEDIA_GRPC_ADDR,
    WORKER_RPC_TOKEN: base.WORKER_RPC_TOKEN,
    UPLOAD_DIR: env.UPLOAD_DIR,
  };
  if (!legacy) {
    await runGo(["build", "-o", mediaBinary, "./cmd/media"]);
    await runGo(["build", "-o", workerBinary, "./cmd/worker"]);
    await command(mediaBinary, ["migrate"], mediaEnv);
    coordinator = managedProcess(mediaBinary, mediaEnv);
    try {
      await waitForMedia(mediaPort, coordinator);
    } catch (error) {
      await coordinator.stop();
      throw error;
    }
    worker = managedProcess(workerBinary, workerEnv);
  }
  let api = managedProcess(binary, env);
  const child = api.child;
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
    await api.stop();
    await worker?.stop();
    await coordinator?.stop();
    throw error;
  }
  let stopped = false;
  let cleaned = false;
  const stopProcess = async () => {
    if (stopped) return;
    stopped = true;
    await api.stop();
    await worker?.stop();
    await coordinator?.stop();
  };
  return {
    target,
    storage,
    get pid() {
      return api.child.pid;
    },
    stopProcess,
    get workerPid() {
      return worker?.child.pid;
    },
    get coordinatorPid() {
      return coordinator?.child.pid;
    },
    stopAPIProcess: (signal) => api.stop(signal),
    restartAPI: async () => {
      await api.stop();
      api = managedProcess(binary, env);
    },
    stopWorker: (signal) => worker?.stop(signal),
    restartWorker: async () => {
      await worker?.stop();
      worker = managedProcess(workerBinary, workerEnv);
    },
    stopCoordinator: (signal) => coordinator?.stop(signal),
    restartCoordinator: async () => {
      await coordinator?.stop();
      coordinator = managedProcess(mediaBinary, mediaEnv);
      await waitForMedia(mediaPort, coordinator);
    },
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
