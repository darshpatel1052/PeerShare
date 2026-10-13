import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { startBackend } from "./backend.mjs";
import { compose } from "./dependencies.mjs";

if (process.env.API_TARGET)
  throw new Error(
    "Recovery checks only operate on the isolated local test stack",
  );
process.env.PEERSCREEN_TEST_RUNTIME = "true";
const options = {
  origin: "http://localhost:3190",
  trackerUrl: "ws://localhost:8190",
  mediaBase: "http://localhost:3190/media/",
  listen: "127.0.0.1:8091",
};
let backend;
let cookie = "";
const observations = [];
async function call(path, { method = "GET", body, anonymous = false } = {}) {
  const response = await fetch(`${backend.target}${path}`, {
    method,
    headers: {
      ...(body
        ? { "Content-Type": "application/json", Origin: options.origin }
        : {}),
      ...(!anonymous && cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const data = response.status === 204 ? null : await response.json();
  observations.push({
    at: new Date().toISOString(),
    method,
    path,
    status: response.status,
    code: data?.code,
    requestId: response.headers.get("X-Request-ID"),
  });
  return { status: response.status, data, response };
}
async function ready() {
  const started = Date.now();
  const deadline = started + 25_000;
  while (Date.now() < deadline) {
    try {
      if ((await call("/health/ready")).status === 200)
        return Date.now() - started;
    } catch {}
    await new Promise((accept) => setTimeout(accept, 250));
  }
  throw new Error("Recovery readiness deadline exceeded");
}
try {
  backend = await startBackend(options);
  const firstPID = backend.pid;
  const email = `${randomUUID()}@example.test`;
  const password = randomBytes(24).toString("hex");
  const registration = await call("/api/v1/auth/register", {
    method: "POST",
    body: { email, password, display_name: "Recovery creator" },
    anonymous: true,
  });
  assert.equal(registration.status, 201);
  cookie = registration.response.headers.getSetCookie()[0].split(";")[0];
  const channel = await call("/api/v1/channels", {
    method: "POST",
    body: {
      handle: `recover-${randomUUID().slice(0, 8)}`,
      title: "Recovery channel",
      description: "Persisted before actual process and database restarts.",
    },
  });
  assert.equal(channel.status, 201);
  const before = (await call("/api/v1/me")).data;
  await backend.stopProcess();
  backend = await startBackend({ ...options, storageRoot: backend.storage });
  const secondPID = backend.pid;
  assert.notEqual(secondPID, firstPID);
  const afterProcessRestart = (await call("/api/v1/me")).data;
  assert.equal(afterProcessRestart.user.id, before.user.id);
  assert.equal(afterProcessRestart.channel.id, before.channel.id);

  await compose(["stop", "postgres"], { test: true, quiet: true });
  assert.equal((await call("/health/live")).status, 200);
  assert.equal((await call("/health/ready")).status, 503);
  assert.equal((await call("/api/v1/videos")).status, 503);
  const databaseRecoveryStart = Date.now();
  await compose(["start", "postgres"], { test: true, quiet: true });
  await ready();
  const databaseRecoveryMs = Date.now() - databaseRecoveryStart;
  const afterDatabaseRestart = (await call("/api/v1/me")).data;
  assert.equal(afterDatabaseRestart.user.id, before.user.id);
  assert.equal(afterDatabaseRestart.channel.id, before.channel.id);

  await compose(["stop", "redis"], { test: true, quiet: true });
  assert.equal((await call("/health/live")).status, 200);
  assert.equal((await call("/health/ready")).status, 503);
  assert.equal((await call("/api/v1/videos")).status, 200);
  assert.equal((await call("/api/v1/me")).status, 200);
  const blockedLogin = await call("/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
    anonymous: true,
  });
  assert.equal(blockedLogin.status, 503);
  assert.equal(blockedLogin.data.code, "limits_unavailable");
  const redisRecoveryStart = Date.now();
  await compose(["start", "redis"], { test: true, quiet: true });
  await ready();
  const redisRecoveryMs = Date.now() - redisRecoveryStart;
  assert.equal(
    (
      await call("/api/v1/auth/login", {
        method: "POST",
        body: { email, password },
        anonymous: true,
      })
    ).status,
    200,
  );
  assert.equal((await call("/api/v1/me")).data.channel.id, before.channel.id);
  await mkdir(".local/evidence", { recursive: true });
  await writeFile(
    ".local/evidence/phase-1-recovery.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        scope:
          "Actual Go OS process replacement and PostgreSQL/Redis container stop/start on the isolated peerscreen-test project; original session cookie reused, no re-registration",
        processIDs: [firstPID, secondPID],
        before,
        afterProcessRestart,
        afterDatabaseRestart,
        databaseRecoveryMs,
        redisRecoveryMs,
        observations,
        exclusions: [
          "Passwords, tokens and connection credentials excluded",
          "This is one-host metadata/session recovery, not backup restoration, multi-host HA or media-job recovery",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS actual API process restart, database persistence and dependency-outage policy.",
  );
} finally {
  await backend?.close();
}
