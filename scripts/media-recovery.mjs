import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { startBackend } from "./backend.mjs";
import { compose } from "./dependencies.mjs";

if (process.env.API_TARGET)
  throw new Error("Media recovery checks require the isolated local stack.");
process.env.PEERSCREEN_TEST_RUNTIME = "true";
const options = {
  legacy: true, // Phase 2 regression; distributed process crashes have a separate Phase 3 runner.
  origin: "http://localhost:3191",
  trackerUrl: "ws://localhost:8191",
  mediaBase: "http://localhost:3191/media/",
  listen: "127.0.0.1:8092",
};
const observations = [];
let backend,
  cookie = "";
const directory = await mkdtemp(join(tmpdir(), "peerscreen-crash-source-"));
async function call(path, { method = "GET", body, raw, headers = {} } = {}) {
  const response = await fetch(`${backend.target}/api/v1${path}`, {
    method,
    headers: {
      Origin: options.origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body
        ? { "Content-Type": "application/json" }
        : raw
          ? { "Content-Type": "application/octet-stream" }
          : {}),
      ...headers,
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(120_000),
  });
  const data = response.status === 204 ? null : await response.json();
  observations.push({
    at: new Date().toISOString(),
    method,
    path,
    status: response.status,
    state: data?.state,
    processing: data?.processing_state,
    stage: data?.processing_stage,
    code: data?.code,
  });
  return { status: response.status, data, response };
}
async function sql(query) {
  return (
    await compose(
      [
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "peerscreen_admin",
        "-d",
        "peerscreen",
        "-tAc",
        query,
      ],
      { test: true, quiet: true },
    )
  ).trim();
}
async function restart({ kill = false } = {}) {
  const previous = backend;
  const storageRoot = backend.storage;
  if (kill) process.kill(backend.pid, "SIGKILL");
  await previous.stopProcess();
  backend = await startBackend({ ...options, storageRoot });
  return backend.pid;
}
try {
  const source = join(directory, "durable.mp4");
  const generated = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=30:duration=20",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      source,
    ],
    { timeout: 60_000 },
  );
  assert.equal(generated.status, 0, "real MP4 generation");
  const payload = await readFile(source);
  assert.ok(payload.length > 8 * 1024 * 1024);
  assert.ok(payload.length < 250 * 1024 * 1024);
  const chunks = [];
  for (let offset = 0; offset < payload.length; offset += 8 * 1024 * 1024)
    chunks.push(payload.subarray(offset, offset + 8 * 1024 * 1024));
  backend = await startBackend(options);
  const pids = [backend.pid];
  const registered = await call("/auth/register", {
    method: "POST",
    body: {
      email: `${randomUUID()}@example.test`,
      password: randomBytes(24).toString("hex"),
      display_name: "Media recovery creator",
    },
  });
  assert.equal(registered.status, 201);
  cookie = registered.response.headers.getSetCookie()[0].split(";")[0];
  const channel = await call("/channels", {
    method: "POST",
    body: {
      handle: `crash-${randomUUID().slice(0, 8)}`,
      title: "Recovered media",
      description: "Real process crash exercise",
    },
  });
  assert.equal(channel.status, 201);
  const u = await call("/uploads", {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: {
      channel_id: channel.data.id,
      title: "Durable recovery film",
      description: "A real transcoded source",
      tags: [],
      size: payload.length,
      part_checksums: chunks.map((part) =>
        createHash("sha256").update(part).digest("hex"),
      ),
    },
  });
  assert.equal(u.status, 201);
  const uploadID = u.data.id,
    videoID = u.data.video_id;
  async function sendPart(number) {
    const granted = await call(`/uploads/${uploadID}/parts/presign`, {
      method: "POST",
      body: { numbers: [number] },
    });
    assert.equal(granted.status, 200);
    assert.equal(
      (
        await call(`/uploads/${uploadID}/parts/${number}`, {
          method: "PUT",
          raw: chunks[number - 1],
          headers: { "Upload-Token": granted.data.parts[0].token },
        })
      ).status,
      200,
    );
  }
  await sendPart(1);
  pids.push(await restart({ kill: true }));
  const resumed = await call(`/uploads/${uploadID}`);
  assert.equal(resumed.status, 200);
  assert.deepEqual(
    resumed.data.parts.map((p) => p.number),
    [1],
  );
  for (let n = 2; n <= chunks.length; n++) await sendPart(n);
  assert.equal(
    (await call(`/uploads/${uploadID}/complete`, { method: "POST" })).status,
    202,
  );
  const runningDeadline = Date.now() + 30_000;
  let stage;
  while (Date.now() < runningDeadline) {
    stage = await call(`/uploads/${uploadID}`);
    if (stage.data.processing_stage === "encoding") break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(
    stage.data.processing_stage,
    "encoding",
    "observe real active FFmpeg job before killing API",
  );
  const beforeClaim = JSON.parse(
    await sql(
      `SELECT json_build_object('job_id',id,'attempt_id',attempt_id,'generation_id',generation_id,'attempt',attempt,'state',state,'lease_expires_at',lease_expires_at) FROM catalog.processing_jobs WHERE video_id='${videoID}'`,
    ),
  );
  console.log(
    "Observed active encode. Killing the API process; recovery must wait for its persisted 60-second lease.",
  );
  const killedAt = Date.now();
  pids.push(await restart({ kill: true }));
  const liveLease = JSON.parse(
    await sql(
      `SELECT json_build_object('attempt_id',attempt_id,'state',state) FROM catalog.processing_jobs WHERE video_id='${videoID}'`,
    ),
  );
  assert.equal(liveLease.state, "running");
  assert.equal(liveLease.attempt_id, beforeClaim.attempt_id);
  console.log(
    "Fresh API preserved the active claim. Waiting for lease expiry and a new fenced attempt.",
  );
  const readyDeadline = Date.now() + 100_000;
  let ready;
  while (Date.now() < readyDeadline) {
    ready = await call(`/uploads/${uploadID}`);
    if (ready.data.processing_state === "ready") break;
    if (ready.data.processing_state === "failed")
      throw new Error(`Recovery failed: ${ready.data.error_code}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(ready.data.processing_state, "ready");
  const afterClaim = JSON.parse(
    await sql(
      `SELECT json_build_object('job_id',id,'attempt_id',attempt_id,'generation_id',generation_id,'attempt',attempt,'state',state) FROM catalog.processing_jobs WHERE video_id='${videoID}'`,
    ),
  );
  assert.equal(afterClaim.job_id, beforeClaim.job_id);
  assert.equal(afterClaim.generation_id, beforeClaim.generation_id);
  assert.notEqual(afterClaim.attempt_id, beforeClaim.attempt_id);
  assert.equal(afterClaim.attempt, 2);
  assert.equal((await call(`/videos/${videoID}`)).status, 404);
  assert.equal(
    (await call(`/videos/${videoID}/publish`, { method: "POST" })).status,
    200,
  );
  const watched = await call(`/videos/${videoID}`);
  assert.equal(watched.status, 200);
  assert.equal(watched.data.accepted_attempt_id, afterClaim.attempt_id);
  const manifestKey = JSON.parse(
    await sql(
      `SELECT json_build_object('manifest',manifest_key) FROM catalog.videos WHERE id='${videoID}'`,
    ),
  ).manifest;
  const decoded = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-i",
      join(backend.storage, "media", manifestKey),
      "-f",
      "null",
      "-",
    ],
    { timeout: 30_000 },
  );
  assert.equal(decoded.status, 0, "recovered output must decode");
  await mkdir(".local/evidence", { recursive: true });
  await writeFile(
    ".local/evidence/phase-2-process-recovery.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        scope:
          "Actual SIGKILL of API during multipart upload and active FFmpeg encoding; real 60-second lease expiry, process replacement, publication and recovered HLS decode",
        sourceBytes: payload.length,
        chunks: chunks.length,
        processIDs: pids,
        beforeClaim,
        afterClaim,
        recoveryMs: Date.now() - killedAt,
        observations,
        exclusions: [
          "Credentials and part permission tokens omitted",
          "Local single-host persistent storage; not S3, Kafka, gRPC or multi-host recovery",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS actual multipart/process crash recovery, fenced re-encode and decoded public HLS.",
  );
} finally {
  await backend?.close();
  await rm(directory, { recursive: true, force: true });
}
