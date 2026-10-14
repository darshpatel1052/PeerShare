import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { resolve, join } from "node:path";
import { localEnvironment } from "./local-environment.mjs";

const run = promisify(execFile);
const environment = await localEnvironment();
const directory = resolve(
  ".local/backups/aws-" + new Date().toISOString().replaceAll(":", "-"),
);
const image = "peerscreen-api:local";
const postgresImage =
  "postgres:18-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c";
const restoreName = "peerscreen-restore-db";
let stopped = [];

async function docker(args, options = {}) {
  const result = await run("docker", args, {
    env: environment,
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  return result.stdout.trim();
}
async function stream(args, { input, output }) {
  const child = spawn("docker", args, {
    env: environment,
    stdio: [input ? "pipe" : "ignore", output ? "pipe" : "ignore", "pipe"],
  });
  child.stderr.on("data", () => {});
  const completion = new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? accept()
        : reject(new Error("Snapshot database operation failed")),
    );
  });
  const transfer = input
    ? pipeline(createReadStream(input), child.stdin)
    : pipeline(
        child.stdout,
        createWriteStream(output, { mode: 0o600, flags: "wx" }),
      );
  await Promise.all([completion, transfer]);
}
const countsSQL = `SELECT json_build_object('users',(SELECT count(*) FROM catalog.users),'channels',(SELECT count(*) FROM catalog.channels),'videos',(SELECT count(*) FROM catalog.videos),'uploads',(SELECT count(*) FROM catalog.upload_sessions),'playlists',(SELECT count(*) FROM catalog.playlists),'media_jobs',(SELECT count(*) FROM media.jobs))`;
async function counts(container) {
  return JSON.parse(
    await docker([
      "exec",
      container,
      "psql",
      "-U",
      "peerscreen_admin",
      "-d",
      "peerscreen",
      "-tAc",
      countsSQL,
    ]),
  );
}
async function files(root, prefix = "") {
  const output = {};
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const key = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) Object.assign(output, await files(root, key));
    else if (entry.isFile())
      output[key] = createHash("sha256")
        .update(await readFile(join(root, key)))
        .digest("hex");
    else throw new Error("Snapshot contains a non-regular file");
  }
  return output;
}
try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const listed = await docker([
    "ps",
    "-q",
    "--filter",
    "label=com.docker.compose.project=peerscreen",
  ]);
  const containers = JSON.parse(
    await docker(["inspect", ...listed.split("\n")]),
  );
  const api = containers.find(
    (c) => c.Config.Labels["com.docker.compose.service"] === "api",
  );
  const database = containers.find(
    (c) => c.Config.Labels["com.docker.compose.service"] === "postgres",
  );
  assert.ok(api && database, "The normal application must be running");
  stopped = containers
    .filter((c) =>
      ["api", "media", "worker", "web"].includes(
        c.Config.Labels["com.docker.compose.service"],
      ),
    )
    .map((c) => c.Id);
  await docker(["stop", ...stopped]);
  const metadata = await counts(database.Id);
  await stream(
    [
      "exec",
      database.Id,
      "pg_dump",
      "-U",
      "peerscreen_admin",
      "-d",
      "peerscreen",
      "-Fc",
    ],
    { output: join(directory, "database.dump") },
  );
  const fingerprints = {};
  for (const [name, destination] of [
    ["uploads", "/app/.local/uploads"],
    ["media", "/app/.local/media"],
  ]) {
    const volume = api.Mounts.find((m) => m.Destination === destination)?.Name;
    assert.ok(volume, "Expected named application volume");
    await stream(
      [
        "run",
        "--rm",
        "--user",
        "0:0",
        "--entrypoint",
        "tar",
        "-v",
        `${volume}:/data:ro`,
        image,
        "-C",
        "/data",
        "-czf",
        "-",
        ".",
      ],
      { output: join(directory, name + ".tgz") },
    );
    const extracted = join(directory, name);
    await mkdir(extracted, { mode: 0o700 });
    await run("tar", [
      "-xzf",
      join(directory, name + ".tgz"),
      "--no-same-owner",
      "--no-same-permissions",
      "-C",
      extracted,
    ]);
    fingerprints[name] = await files(extracted);
  }
  // Resume the exact original containers; no image/schema upgrade is implied.
  await docker(["start", ...stopped]);
  stopped = [];
  await docker([
    "run",
    "-d",
    "--name",
    restoreName,
    "--network",
    "none",
    "-e",
    "POSTGRES_DB=peerscreen",
    "-e",
    "POSTGRES_USER=peerscreen_admin",
    "-e",
    "POSTGRES_PASSWORD",
    "-e",
    "CATALOG_DB_PASSWORD",
    "-e",
    "MEDIA_DB_PASSWORD",
    "-v",
    `${resolve("deploy/postgres/init-catalog.sh")}:/docker-entrypoint-initdb.d/10-catalog.sh:ro`,
    "-v",
    `${resolve("deploy/postgres/bootstrap-media.sh")}:/docker-entrypoint-initdb.d/20-media.sh:ro`,
    postgresImage,
  ]);
  const end = Date.now() + 60000;
  let ready = false;
  while (Date.now() < end) {
    try {
      ready =
        (await docker([
          "exec",
          restoreName,
          "psql",
          "-U",
          "peerscreen_admin",
          "-d",
          "peerscreen",
          "-tAc",
          "SELECT count(*) FROM pg_roles WHERE rolname IN ('peerscreen_media','peerscreen_catalog')",
        ])) === "2";
      if (ready) break;
    } catch {}
    await new Promise((accept) => setTimeout(accept, 300));
  }
  assert.ok(ready, "Isolated restore database did not initialize");
  await stream(
    [
      "exec",
      "-i",
      restoreName,
      "pg_restore",
      "-U",
      "peerscreen_admin",
      "-d",
      "peerscreen",
      "--clean",
      "--if-exists",
      "--exit-on-error",
    ],
    { input: join(directory, "database.dump") },
  );
  assert.deepEqual(await counts(restoreName), metadata);
  for (const name of ["uploads", "media"]) {
    const restored = join(directory, "restored-" + name);
    await mkdir(restored, { mode: 0o700 });
    await run("tar", [
      "-xzf",
      join(directory, name + ".tgz"),
      "--no-same-owner",
      "--no-same-permissions",
      "-C",
      restored,
    ]);
    assert.deepEqual(await files(restored), fingerprints[name]);
    await rm(restored, { recursive: true });
  }
  const archives = {};
  for (const name of ["database.dump", "uploads.tgz", "media.tgz"]) {
    archives[name] = {
      bytes: (await stat(join(directory, name))).size,
      sha256: createHash("sha256")
        .update(await readFile(join(directory, name)))
        .digest("hex"),
    };
  }
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        metadata,
        archives,
        fingerprints,
        restoredDatabase: true,
        restoredFiles: true,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  await mkdir(resolve(".local/aws"), { recursive: true, mode: 0o700 });
  await writeFile(resolve(".local/aws/backup-path.txt"), directory + "\n", {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      snapshot: directory,
      databaseRestore: true,
      mediaHashesMatched: true,
      counts: metadata,
      mediaFiles: Object.keys(fingerprints.media).length,
      uploadFiles: Object.keys(fingerprints.uploads).length,
    }),
  );
} finally {
  if (stopped.length) await docker(["start", ...stopped]).catch(() => {});
  await docker(["rm", "-f", "-v", restoreName]).catch(() => {});
}
