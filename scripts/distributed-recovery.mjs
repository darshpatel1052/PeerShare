import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startBackend } from "./backend.mjs";
import { compose } from "./dependencies.mjs";
import { localEnvironment } from "./local-environment.mjs";
import { runGo } from "./go.mjs";

if (process.env.API_TARGET)
  throw new Error(
    "Distributed recovery requires the disposable local test stack.",
  );
process.env.PEERSCREEN_TEST_RUNTIME = "true";
const run = promisify(execFile);
const options = {
  origin: "http://localhost:3192",
  trackerUrl: "ws://localhost:8192",
  mediaBase: "http://localhost:3192/media/",
  listen: "127.0.0.1:8093",
};
const directory = await mkdtemp(
  join(tmpdir(), "peerscreen-distributed-source-"),
);
let backend,
  cookie = "";
const observations = [];
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
    signal: AbortSignal.timeout(120000),
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
function safeID(id) {
  assert.match(
    id,
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  );
  return id;
}
async function jobRow(id) {
  return JSON.parse(
    await sql(
      `SELECT json_build_object('job_id',j.id,'generation_id',j.generation_id,'state',j.state,'attempts',j.attempts,'version',j.version,'epoch',(SELECT max(epoch) FROM media.claim_requests WHERE job_id=j.id),'attempt_id',(SELECT attempt_id FROM media.claim_requests WHERE job_id=j.id ORDER BY epoch DESC LIMIT 1),'worker_id',(SELECT worker_id FROM media.claim_requests WHERE job_id=j.id ORDER BY epoch DESC LIMIT 1),'pending_events',(SELECT count(*) FROM media.outbox WHERE aggregate_id=j.video_id AND published_at IS NULL)) FROM media.jobs j WHERE id='${safeID(id)}'`,
    ),
  );
}
async function until(check, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((accept) => setTimeout(accept, 100));
  }
  throw new Error("Distributed recovery observation deadline exceeded");
}
async function encoderPID() {
  const result = await run("ps", ["-eo", "pid,ppid,comm"]);
  for (const line of result.stdout.trim().split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (Number(fields[1]) === backend.workerPid && fields[2] === "ffmpeg")
      return Number(fields[0]);
  }
  return null;
}
try {
  const source = join(directory, "owned.mp4");
  await run("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=30",
    "-t",
    "30",
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
  const partBytes = 8 * 1024 * 1024;
  const chunks = [];
  for (let start = 0; start < payload.length; start += partBytes)
    chunks.push(payload.subarray(start, start + partBytes));
  backend = await startBackend(options);
  const initialAPI = backend.pid;
  const registration = await call("/auth/register", {
    method: "POST",
    body: {
      email: `${randomUUID()}@example.test`,
      password: randomBytes(24).toString("hex"),
      display_name: "Distributed recovery creator",
    },
  });
  assert.equal(registration.status, 201);
  cookie = registration.response.headers.getSetCookie()[0].split(";")[0];
  const channel = await call("/channels", {
    method: "POST",
    body: {
      handle: `recovery-${randomUUID().slice(0, 8)}`,
      title: "Recovery channel",
      description: "Owned generated source",
    },
  });
  assert.equal(channel.status, 201);
  await backend.stopWorker();
  await compose(["stop", "kafka"], { test: true, quiet: true });
  const created = await call("/uploads", {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: {
      channel_id: channel.data.id,
      title: "Distributed recovery film",
      description: "Owned media for process recovery",
      tags: [],
      size: payload.length,
      part_checksums: chunks.map((part) =>
        createHash("sha256").update(part).digest("hex"),
      ),
    },
  });
  assert.equal(created.status, 201);
  const upload = created.data;
  for (let index = 0; index < chunks.length; index++) {
    const grant = await call(`/uploads/${upload.id}/parts/presign`, {
      method: "POST",
      body: { numbers: [index + 1] },
    });
    assert.equal(grant.status, 200);
    assert.equal(
      (
        await call(`/uploads/${upload.id}/parts/${index + 1}`, {
          method: "PUT",
          raw: chunks[index],
          headers: { "Upload-Token": grant.data.parts[0].token },
        })
      ).status,
      200,
    );
  }
  assert.equal(
    (await call(`/uploads/${upload.id}/complete`, { method: "POST" })).status,
    202,
  );
  const pending = await until(async () => {
    const item = await call(`/uploads/${upload.id}`);
    if (!item.data.job_id) return false;
    const exists = await sql(
      `SELECT count(*) FROM media.jobs WHERE id='${safeID(item.data.job_id)}'`,
    );
    return exists === "1" ? item.data : false;
  });
  const beforeBroker = await jobRow(pending.job_id);
  assert.equal(beforeBroker.state, "queued");
  assert.ok(beforeBroker.pending_events >= 2);
  const oldCoordinator = backend.coordinatorPid;
  await backend.stopCoordinator("SIGKILL");
  await backend.restartCoordinator();
  assert.notEqual(backend.coordinatorPid, oldCoordinator);
  const afterCoordinator = await jobRow(pending.job_id);
  assert.equal(afterCoordinator.job_id, beforeBroker.job_id);
  assert.equal(afterCoordinator.generation_id, beforeBroker.generation_id);
  assert.equal(afterCoordinator.state, "queued");
  assert.ok(afterCoordinator.pending_events >= 2);
  console.log(
    "Broker outage retained the job and its outbox across an actual coordinator SIGKILL.",
  );
  await compose(["up", "-d", "--wait", "--wait-timeout", "60", "kafka"], {
    test: true,
    quiet: true,
  });
  await backend.restartWorker();
  const activeEncoder = await until(encoderPID, 40000);
  const beforeWorker = await jobRow(pending.job_id);
  assert.equal(beforeWorker.state, "running");
  assert.equal(beforeWorker.attempts, 1);
  const killedAt = Date.now();
  const oldWorker = backend.workerPid;
  await backend.stopWorker("SIGKILL");
  await until(async () => {
    const result = await run("ps", ["-eo", "pid,stat"]);
    const row = result.stdout
      .split("\n")
      .find((line) => Number(line.trim().split(/\s+/)[0]) === activeEncoder);
    return !row || row.trim().split(/\s+/)[1].startsWith("Z");
  }, 5000);
  const retainedLease = await jobRow(pending.job_id);
  assert.equal(retainedLease.state, "running");
  assert.equal(retainedLease.attempt_id, beforeWorker.attempt_id);
  await backend.restartWorker();
  assert.notEqual(backend.workerPid, oldWorker);
  console.log(
    "Worker SIGKILL stopped its actual FFmpeg child. Recovery must respect the existing sixty-second lease.",
  );
  const ready = await until(async () => {
    const item = await call(`/uploads/${upload.id}`);
    if (item.data.processing_state === "failed")
      throw new Error("Distributed processing failed");
    return item.data.processing_state === "ready" ? item.data : false;
  }, 110000);
  const afterWorker = await jobRow(pending.job_id);
  assert.equal(afterWorker.job_id, beforeWorker.job_id);
  assert.equal(afterWorker.generation_id, beforeWorker.generation_id);
  assert.equal(afterWorker.attempts, 2);
  assert.equal(afterWorker.epoch, 2);
  assert.notEqual(afterWorker.attempt_id, beforeWorker.attempt_id);
  assert.equal(afterWorker.state, "ready");
  const checker = resolve(".local/bin/mediacheck");
  await runGo(["build", "-o", checker, "./cmd/mediacheck"]);
  const privateEnv = await localEnvironment({ test: true });
  const stale = await run(
    checker,
    [
      "-job",
      beforeWorker.job_id,
      "-attempt",
      beforeWorker.attempt_id,
      "-worker",
      beforeWorker.worker_id,
      "-epoch",
      String(beforeWorker.epoch),
      "-descriptor",
      `videos/${upload.video_id}/${beforeWorker.generation_id}/${beforeWorker.attempt_id}/output.json`,
    ],
    {
      env: {
        PATH: process.env.PATH,
        MEDIA_GRPC_ADDR: "127.0.0.1:19091",
        WORKER_RPC_TOKEN: privateEnv.WORKER_RPC_TOKEN,
      },
    },
  );
  assert.equal(JSON.parse(stale.stdout).status_code, "FailedPrecondition");
  assert.equal((await call(`/videos/${upload.video_id}`)).status, 404);
  assert.equal(
    (await call(`/videos/${upload.video_id}/publish`, { method: "POST" }))
      .status,
    200,
  );
  const publicVideo = await call(`/videos/${upload.video_id}`);
  assert.equal(publicVideo.status, 200);
  assert.deepEqual(publicVideo.data.qualities, [480, 720]);
  for (const quality of [480, 720]) {
    const playlist = join(
      backend.storage,
      "media",
      "videos",
      upload.video_id,
      afterWorker.generation_id,
      afterWorker.attempt_id,
      `${quality}p/index.m3u8`,
    );
    await run("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-protocol_whitelist",
      "file,crypto,data",
      "-i",
      playlist,
      "-f",
      "null",
      "-",
    ]);
  }
  await backend.stopAPIProcess("SIGKILL");
  await backend.restartAPI();
  assert.notEqual(backend.pid, initialAPI);
  await until(async () => {
    try {
      return (await call(`/videos/${upload.video_id}`)).status === 200;
    } catch {
      return false;
    }
  });
  assert.equal((await call("/me")).status, 200);
  const evidence = {
    checkedOn: new Date().toISOString(),
    scope:
      "isolated local single-host services; actual Kafka, gRPC, PostgreSQL and FFmpeg",
    sourceBytes: payload.length,
    renditions: [480, 720],
    brokerOutage: {
      before: beforeBroker,
      afterCoordinatorRestart: afterCoordinator,
    },
    workerCrash: {
      before: beforeWorker,
      retainedLease,
      after: afterWorker,
      recoveryMilliseconds: Date.now() - killedAt,
      actualFFmpegChildStopped: true,
      staleCompletionStatus: "FailedPrecondition",
    },
    apiRestart: { originalSessionRetained: true, publishedVideoRetained: true },
    observations,
  };
  await mkdir(".local/evidence", { recursive: true });
  await writeFile(
    ".local/evidence/phase-3-process-recovery.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    "PASS distributed broker/coordinator/worker/API recovery, stale completion fencing, and actual 480p/720p decode.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await backend?.close();
  if (!backend)
    await compose(["down", "--volumes"], { test: true, quiet: true }).catch(
      () => {},
    );
  await rm(directory, { recursive: true, force: true });
}
