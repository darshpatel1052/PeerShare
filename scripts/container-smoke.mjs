import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compose } from "./dependencies.mjs";
import { startContainerApp } from "./compose-demo.mjs";
import { localEnvironment } from "./local-environment.mjs";
import { runGo } from "./go.mjs";

if (process.env.API_TARGET)
  throw new Error("Container smoke uses only its disposable test project.");
process.env.PEERSCREEN_WEB_PORT = "3220";
process.env.PEERSCREEN_MEDIA_PORT = "3221";
process.env.PEERSCREEN_TRACKER_PORT = "8220";
process.env.PEERSCREEN_API_PORT = "18082";
const origin = "http://localhost:3220";
const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "peerscreen-container-"));
const observations = [];
const s3Mode = process.env.PEERSCREEN_S3_REHEARSAL === "true";
const overlays = s3Mode ? ["deploy/compose/local-s3.yml"] : [];
const storageChecks = {};
let cookie = "";
async function call(path, { method = "GET", body, raw, headers = {} } = {}) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body
        ? { "Content-Type": "application/json" }
        : raw
          ? { "Content-Type": "application/octet-stream" }
          : {}),
      ...headers,
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(120000),
  });
  const data = response.status === 204 ? null : await response.json();
  observations.push({
    path,
    method,
    status: response.status,
    stage: data?.processing_stage,
    processing: data?.processing_state,
  });
  return { status: response.status, data, response };
}
try {
  await startContainerApp({ test: true, overlays });
  if (s3Mode)
    await runGo(
      ["run", "./cmd/storage-tool"],
      await localEnvironment({ test: true }),
    );
  assert.equal((await fetch(origin + "/health/ready")).status, 200);
  assert.equal((await fetch(origin + "/account/")).status, 200);
  assert.equal((await call("/api/v1/auth/options")).data.google_enabled, false);
  const registered = await call("/api/v1/auth/register", {
    method: "POST",
    body: {
      email: `${randomUUID()}@example.test`,
      password: randomBytes(24).toString("hex"),
      display_name: "Container creator",
    },
  });
  assert.equal(registered.status, 201);
  cookie = registered.response.headers.getSetCookie()[0].split(";")[0];
  const channel = await call("/api/v1/channels", {
    method: "POST",
    body: {
      handle: `container-${randomUUID().slice(0, 8)}`,
      title: "Container channel",
      description: "Owned generated source",
    },
  });
  assert.equal(channel.status, 201);
  const source = join(directory, "source.mp4");
  await run("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=30",
    "-t",
    "3",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-threads",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-y",
    source,
  ]);
  const payload = await readFile(source);
  assert.ok(payload.length < 8 * 1024 * 1024);
  const created = await call("/api/v1/uploads", {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: {
      channel_id: channel.data.id,
      title: "Container video",
      description: "Actual packaged worker output",
      tags: [],
      size: payload.length,
      part_checksums: [createHash("sha256").update(payload).digest("hex")],
    },
  });
  assert.equal(created.status, 201);
  const upload = created.data;
  const grant = await call(`/api/v1/uploads/${upload.id}/parts/presign`, {
    method: "POST",
    body: { numbers: [1] },
  });
  assert.equal(grant.status, 200);
  assert.equal(
    (
      await call(`/api/v1/uploads/${upload.id}/parts/1`, {
        method: "PUT",
        raw: payload,
        headers: { "Upload-Token": grant.data.parts[0].token },
      })
    ).status,
    200,
  );
  if (s3Mode) {
    await compose(
      ["exec", "-T", "api", "rm", "-rf", `/app/.local/uploads/${upload.id}`],
      { test: true, overlays, quiet: true },
    );
    assert.equal(
      (await call(`/api/v1/uploads/${upload.id}`)).data.parts.length,
      1,
    );
    storageChecks.resumeWithoutLocalPart = true;
  }
  assert.equal(
    (await call(`/api/v1/uploads/${upload.id}/complete`, { method: "POST" }))
      .status,
    202,
  );
  const deadline = Date.now() + 45000;
  let progress;
  while (Date.now() < deadline) {
    progress = await call(`/api/v1/uploads/${upload.id}`);
    if (progress.data.processing_state === "ready") break;
    if (progress.data.processing_state === "failed")
      throw new Error("Packaged worker failed processing");
    await new Promise((accept) => setTimeout(accept, 100));
  }
  assert.equal(progress.data.processing_state, "ready");
  if (s3Mode) {
    const preview = await call(`/api/v1/videos/${upload.video_id}/preview`);
    assert.equal(preview.status, 200);
    assert.equal((await fetch(preview.data.playback.manifest_url)).status, 404);
    assert.equal(
      (
        await fetch(preview.data.playback.manifest_url, {
          headers: { Cookie: cookie },
        })
      ).status,
      200,
    );
    storageChecks.privatePreview = true;
    const audit = JSON.parse(
      await runGo(
        ["run", "./cmd/storage-tool", "audit-video", upload.video_id],
        await localEnvironment({ test: true }),
        { json: true },
      ),
    );
    assert.equal(audit.sourceObjects, 1);
    assert.ok(audit.processedObjects >= 7);
    storageChecks.objectsBeforeCleanup = audit;
    await compose(
      [
        "exec",
        "-T",
        "api",
        "rm",
        "-rf",
        `/app/.local/media/videos/${upload.video_id}`,
      ],
      { test: true, overlays, quiet: true },
    );
    storageChecks.localOutputRemoved = true;
  }
  assert.equal(
    (
      await call(`/api/v1/videos/${upload.video_id}/publish`, {
        method: "POST",
      })
    ).status,
    200,
  );
  const video = await call(`/api/v1/videos/${upload.video_id}`);
  assert.equal(video.status, 200);
  assert.deepEqual(video.data.qualities, [480, 720]);
  const follow = await call(
    `/api/v1/channels/${channel.data.id}/subscription`,
    { method: "POST", body: {} },
  );
  assert.equal(follow.status, 200);
  assert.equal(follow.data.following, true);
  const feed = await call("/api/v1/videos?feed=following&q=video");
  assert.equal(feed.status, 200);
  assert.equal(feed.data.items[0].id, upload.video_id);
  const playlist = await call("/api/v1/playlists", {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: { title: "Watch later", visibility: "private" },
  });
  assert.equal(playlist.status, 201);
  const saved = await call(`/api/v1/playlists/${playlist.data.id}/items`, {
    method: "POST",
    body: { video_id: upload.video_id, revision: playlist.data.revision },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.items[0].video_id, upload.video_id);
  const ownerCookie = cookie;
  cookie = "";
  assert.equal(
    (await call(`/api/v1/playlists/${playlist.data.id}`)).status,
    404,
  );
  cookie = ownerCookie;
  const manifest = await fetch(video.data.playback.manifest_url);
  assert.equal(manifest.status, 200);
  const master = await manifest.text();
  assert.ok(
    master.includes("480p/index.m3u8") && master.includes("720p/index.m3u8"),
  );
  const mediaBase = new URL(".", video.data.playback.manifest_url);
  for (const quality of [480, 720]) {
    const playlistURL = new URL(`${quality}p/index.m3u8`, mediaBase);
    const playlist = await fetch(playlistURL);
    assert.equal(playlist.status, 200);
    const segmentName = (await playlist.text())
      .split("\n")
      .find((line) => line && !line.startsWith("#"));
    assert.ok(segmentName);
    const segment = await fetch(new URL(segmentName, playlistURL));
    assert.equal(segment.status, 200);
    assert.ok((await segment.arrayBuffer()).byteLength > 0);
  }
  if (s3Mode) {
    const poster = await fetch(video.data.thumbnail_url);
    assert.equal(poster.status, 200);
    const banner = await call(`/api/v1/channels/${channel.data.id}/banner`, {
      method: "PUT",
      raw: Buffer.from(await poster.arrayBuffer()),
      headers: {
        "Content-Type": "image/jpeg",
        "If-Match": String(channel.data.revision),
      },
    });
    assert.equal(banner.status, 200);
    assert.equal((await fetch(banner.data.banner_url)).status, 200);
    storageChecks.artwork = true;
    assert.equal(
      (
        await call(`/api/v1/videos/${upload.video_id}/unpublish`, {
          method: "POST",
        })
      ).status,
      200,
    );
    assert.equal((await fetch(video.data.playback.manifest_url)).status, 404);
    assert.equal(
      (
        await fetch(video.data.playback.manifest_url, {
          headers: { Cookie: cookie },
        })
      ).status,
      200,
    );
    storageChecks.unpublication = true;
    assert.equal(
      (await call(`/api/v1/videos/${upload.video_id}`, { method: "DELETE" }))
        .status,
      204,
    );
    assert.equal(
      (
        await fetch(video.data.playback.manifest_url, {
          headers: { Cookie: cookie },
        })
      ).status,
      404,
    );
    let audit;
    const cleanupDeadline = Date.now() + 30000;
    while (Date.now() < cleanupDeadline) {
      audit = JSON.parse(
        await runGo(
          ["run", "./cmd/storage-tool", "audit-video", upload.video_id],
          await localEnvironment({ test: true }),
          { json: true },
        ),
      );
      if (audit.processedObjects === 0 && audit.sourceObjects === 0) break;
      await new Promise((accept) => setTimeout(accept, 500));
    }
    assert.deepEqual(audit, { processedObjects: 0, sourceObjects: 0 });
    storageChecks.objectsAfterCleanup = audit;
  }
  const evidence = {
    storage: s3Mode ? "S3-compatible Versity 1.9.0" : "local filesystem",
    ...(s3Mode ? { storageChecks } : {}),
    checkedOn: new Date().toISOString(),
    scope:
      "real Compose web/API/coordinator/worker, separate schema credentials, Kafka and persistent test volumes",
    staticRoutes: true,
    googleCredentialsExcluded: true,
    actualWorkerProcessing: true,
    renditions: [480, 720],
    publishedManifestAndSegments: true,
    viewerLibrary: true,
    observations,
  };
  await mkdir(".local/evidence", { recursive: true });
  await writeFile(
    s3Mode
      ? ".local/evidence/phase-5-s3-container.json"
      : ".local/evidence/phase-3-container-smoke.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    "PASS actual container startup, upload, packaged worker, publication and 480p/720p media HTTP access.",
  );
} catch (error) {
  console.error(error.message);
  console.error(JSON.stringify({ recentOperations: observations.slice(-5) }));
  process.exitCode = 1;
} finally {
  await compose(["down", "--volumes"], {
    test: true,
    quiet: true,
    overlays,
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  try {
    const remaining = await compose(
      ["--profile", "app", "ps", "--all", "--format", "json"],
      { test: true, quiet: true },
    );
    assert.ok(
      remaining.trim() === "" || remaining.trim() === "[]",
      "Disposable app containers survived cleanup",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  await rm(directory, { recursive: true, force: true });
}
