import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { resolve, join } from "node:path";
import { localEnvironment } from "./local-environment.mjs";

const run = promisify(execFile);
export async function restoreSnapshot(directory) {
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  for (const [name, entry] of Object.entries(manifest.archives))
    assert.equal(
      createHash("sha256")
        .update(await readFile(join(directory, name)))
        .digest("hex"),
      entry.sha256,
    );
  const environment = await localEnvironment();
  const container = "peerscreen-backup-restore-" + randomUUID().slice(0, 8);
  async function docker(args) {
    return (
      await run("docker", args, {
        env: environment,
        timeout: 90000,
        maxBuffer: 1024 * 1024,
      })
    ).stdout.trim();
  }
  try {
    await docker([
      "run",
      "-d",
      "--name",
      container,
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
      resolve("deploy/postgres/init-catalog.sh") +
        ":/docker-entrypoint-initdb.d/10-catalog.sh:ro",
      "-v",
      resolve("deploy/postgres/bootstrap-media.sh") +
        ":/docker-entrypoint-initdb.d/20-media.sh:ro",
      "postgres:18-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c",
    ]);
    const end = Date.now() + 60000;
    let ready = false;
    while (Date.now() < end) {
      try {
        ready =
          (await docker([
            "exec",
            container,
            "psql",
            "-U",
            "peerscreen_admin",
            "-d",
            "peerscreen",
            "-tAc",
            "SELECT count(*) FROM pg_roles WHERE rolname IN ('peerscreen_catalog','peerscreen_media')",
          ])) === "2";
        if (ready) break;
      } catch {}
      await new Promise((accept) => setTimeout(accept, 250));
    }
    assert.ok(ready);
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        container,
        "pg_restore",
        "-U",
        "peerscreen_admin",
        "-d",
        "peerscreen",
        "--clean",
        "--if-exists",
        "--exit-on-error",
      ],
      { env: environment, stdio: ["pipe", "ignore", "pipe"] },
    );
    child.stderr.on("data", () => {});
    const completion = new Promise((accept, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? accept() : reject(new Error("Snapshot restore failed")),
      );
    });
    await Promise.all([
      completion,
      pipeline(createReadStream(join(directory, "database.dump")), child.stdin),
    ]);
    const counts = JSON.parse(
      await docker([
        "exec",
        container,
        "psql",
        "-U",
        "peerscreen_admin",
        "-d",
        "peerscreen",
        "-tAc",
        "SELECT json_build_object('users',(SELECT count(*) FROM catalog.users),'channels',(SELECT count(*) FROM catalog.channels),'videos',(SELECT count(*) FROM catalog.videos),'uploads',(SELECT count(*) FROM catalog.upload_sessions),'playlists',(SELECT count(*) FROM catalog.playlists),'media_jobs',(SELECT count(*) FROM media.jobs))",
      ]),
    );
    assert.deepEqual(counts, manifest.metadata);
    let matched = 0;
    for (const name of ["uploads", "media"]) {
      const target = join(directory, "restore-" + name);
      await mkdir(target, { recursive: true, mode: 0o700 });
      await run("tar", [
        "-xzf",
        join(directory, name + ".tgz"),
        "--no-same-owner",
        "--no-same-permissions",
        "-C",
        target,
      ]);
      for (const [key, hash] of Object.entries(manifest.fingerprints[name])) {
        assert.equal(
          createHash("sha256")
            .update(await readFile(join(target, key)))
            .digest("hex"),
          hash,
        );
        matched++;
      }
      await rm(target, { recursive: true });
    }
    return {
      checkedAt: new Date().toISOString(),
      counts,
      restoredDatabase: true,
      matchedFiles: matched,
      restoredFiles: true,
    };
  } finally {
    await docker(["rm", "-f", "-v", container]).catch(() => {});
  }
}
