import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { request, chromium } from "@playwright/test";
import { compose } from "./dependencies.mjs";
import { startContainerApp } from "./compose-demo.mjs";
import { gatewayConfig } from "./gateway-config.mjs";

// Only the disposable project is used. A self-signed localhost certificate
// rehearses HTTPS/WSS, not public CA issuance or a real cross-network link.
const run = promisify(execFile),
  dev = "http://localhost:3220",
  origin = "https://localhost:3443";
const operations = process.env.PEERSCREEN_OPERATIONS_REHEARSAL === "true";
if (operations) {
  process.env.GRAFANA_ADMIN_PASSWORD = randomBytes(24).toString("hex");
  process.env.OTEL_SAMPLE_RATIO = "1";
  process.env.COMPOSE_PROFILES = "app,ops";
}
Object.assign(process.env, {
  PEERSCREEN_WEB_PORT: "3220",
  PEERSCREEN_MEDIA_PORT: "3221",
  PEERSCREEN_TRACKER_PORT: "8220",
  PEERSCREEN_API_PORT: "18082",
  PEERSCREEN_GATEWAY_ORIGIN: origin,
  PEERSCREEN_GATEWAY_WS_ORIGIN: "wss://localhost:3443",
  API_REPLICA_DIAGNOSTICS: "true",
  PEERSCREEN_GATEWAY_UID: String(process.getuid()),
  PEERSCREEN_GATEWAY_GID: String(process.getgid()),
});
const network = ["deploy/compose/gateway-network.yml"],
  operatorOverlay = operations
    ? ["deploy/compose/operations.yml", "deploy/compose/operations-network.yml"]
    : [],
  overlays = ["deploy/compose/gateway.yml", ...operatorOverlay];
const directory = await mkdtemp(join(tmpdir(), "peerscreen-gateway-"));
const password = randomBytes(24).toString("hex"),
  email = `${randomUUID()}@example.test`;
let initial, secure, browser;
async function call(api, base, path, method = "GET", data, headers = {}) {
  return api.fetch(path, {
    method,
    data,
    headers: { Origin: base, ...headers },
  });
}
async function until(action, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await action()) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(message);
}
try {
  await mkdir(".local/gateway", { recursive: true, mode: 0o700 });
  await writeFile(
    ".local/gateway/envoy.json",
    JSON.stringify(gatewayConfig(origin), null, 2) + "\n",
    { mode: 0o600 },
  );
  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    ".local/gateway/key.pem",
    "-out",
    ".local/gateway/cert.pem",
    "-days",
    "7",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);
  await run("chmod", [
    "600",
    ".local/gateway/key.pem",
    ".local/gateway/cert.pem",
  ]);
  if (operations)
    await compose(
      [
        "--profile",
        "ops",
        "up",
        "-d",
        "--no-build",
        "prometheus",
        "grafana",
        "jaeger",
      ],
      { test: true, overlays: [...network, ...operatorOverlay] },
    );
  await startContainerApp({
    test: true,
    overlays: [...network, ...operatorOverlay],
  });
  initial = await request.newContext({ baseURL: dev });
  let response = await call(initial, dev, "/api/v1/auth/register", "POST", {
    email,
    password,
    display_name: "Gateway creator",
  });
  assert.equal(response.status(), 201);
  const me = await response.json();
  response = await call(initial, dev, "/api/v1/channels", "POST", {
    handle: `gateway-${randomUUID().slice(0, 8)}`,
    title: "Gateway films",
    description: "Owned generated source",
  });
  assert.equal(response.status(), 201);
  const channel = await response.json();
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
    "12",
    "-c:v",
    "libx264",
    "-threads",
    "2",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-y",
    source,
  ]);
  const payload = await readFile(source),
    parts = [];
  for (let offset = 0; offset < payload.length; offset += 8 * 1024 * 1024)
    parts.push(payload.subarray(offset, offset + 8 * 1024 * 1024));
  response = await call(
    initial,
    dev,
    "/api/v1/uploads",
    "POST",
    {
      channel_id: channel.id,
      title: "Through the gateway",
      description: "Actual uploaded HLS",
      tags: [],
      size: payload.length,
      part_checksums: parts.map((part) =>
        createHash("sha256").update(part).digest("hex"),
      ),
    },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(response.status(), 201);
  const upload = await response.json();
  for (let offset = 0; offset < parts.length; offset += 3) {
    response = await call(
      initial,
      dev,
      `/api/v1/uploads/${upload.id}/parts/presign`,
      "POST",
      {
        numbers: parts.slice(offset, offset + 3).map((_, i) => offset + i + 1),
      },
    );
    assert.equal(response.status(), 200);
    const grants = (await response.json()).parts;
    for (let i = 0; i < grants.length; i++)
      assert.equal(
        (
          await call(
            initial,
            dev,
            `/api/v1/uploads/${upload.id}/parts/${offset + i + 1}`,
            "PUT",
            parts[offset + i],
            {
              "Content-Type": "application/octet-stream",
              "Upload-Token": grants[i].token,
            },
          )
        ).status(),
        200,
      );
  }
  assert.equal(
    (
      await call(initial, dev, `/api/v1/uploads/${upload.id}/complete`, "POST")
    ).status(),
    202,
  );
  await until(
    async () => {
      const r = await call(initial, dev, `/api/v1/uploads/${upload.id}`);
      return (await r.json()).processing_state === "ready";
    },
    "Packaged upload did not become ready",
    60000,
  );
  assert.equal(
    (
      await call(
        initial,
        dev,
        `/api/v1/videos/${upload.video_id}/publish`,
        "POST",
      )
    ).status(),
    200,
  );
  await compose(["--profile", "app", "stop", "web", "api"], {
    test: true,
    overlays: [...network, ...operatorOverlay],
  });
  await compose(
    [
      "--profile",
      "app",
      "up",
      "-d",
      "--no-build",
      "--wait",
      "--wait-timeout",
      "120",
      "web",
      "gateway",
    ],
    { test: true, overlays },
  );
  secure = await request.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  await until(
    async () => (await call(secure, origin, "/health/ready")).status() === 200,
    "TLS gateway did not become ready",
  );
  assert.equal(
    (
      await call(secure, origin, "/api/v1/auth/register", "POST", {
        email: `${randomUUID()}@example.test`,
        password,
        display_name: "Closed registration",
      })
    ).status(),
    403,
  );
  response = await call(secure, origin, "/api/v1/auth/login", "POST", {
    email,
    password,
  });
  assert.equal(response.status(), 200);
  const cookie = response.headers()["set-cookie"];
  assert.ok(
    cookie.includes("__Host-peerscreen_session=") &&
      cookie.includes("Secure") &&
      cookie.includes("HttpOnly"),
  );
  const replicas = new Set();
  for (let index = 0; index < 12; index++) {
    const r = await call(secure, origin, "/api/v1/me");
    assert.equal(r.status(), 200);
    assert.equal((await r.json()).user.id, me.user.id);
    replicas.add(r.headers()["x-peerscreen-replica"]);
  }
  assert.equal(replicas.size, 2);
  const publicVideo = await (
    await call(secure, origin, `/api/v1/videos/${upload.video_id}`)
  ).json();
  assert.ok(publicVideo.playback.manifest_url.startsWith(origin));
  assert.equal(
    publicVideo.playback.tracker_url,
    "wss://localhost:3443/tracker",
  );
  assert.deepEqual(publicVideo.playback.stun_urls, []);
  assert.equal(
    (await secure.get(publicVideo.playback.manifest_url)).status(),
    200,
  );
  assert.equal(
    (await secure.get(publicVideo.playback.integrity_url)).status(),
    200,
  );
  assert.equal((await call(secure, origin, "/metrics")).status(), 404);
  let operatorEvidence;
  if (operations) {
    let replicaCount;
    await until(
      async () => {
        const response = await fetch(
          "http://localhost:19091/api/v1/query?query=" +
            encodeURIComponent('sum(up{job="catalogue"})'),
        );
        const result = await response.json();
        replicaCount = Number(result.data?.result?.[0]?.value?.[1]);
        return replicaCount === 2;
      },
      "Prometheus did not scrape both catalogue replicas",
      30000,
    );
    const authorization =
      "Basic " +
      Buffer.from("admin:" + process.env.GRAFANA_ADMIN_PASSWORD).toString(
        "base64",
      );
    let panelCount;
    await until(
      async () => {
        const response = await fetch(
          "http://localhost:3301/api/dashboards/uid/peerscreen-operations",
          { headers: { Authorization: authorization } },
        );
        const result = await response.json();
        panelCount = result.dashboard?.panels?.length;
        return response.ok && panelCount === 8;
      },
      "Provisioned Grafana dashboard unavailable",
      30000,
    );
    let traces;
    let linkedRPC = false;
    await until(
      async () => {
        const query = new URLSearchParams({
          "query.serviceName": "peerscreen-worker",
          "query.operationName": "process_video_attempt",
          "query.startTimeMin": new Date(Date.now() - 3600000).toISOString(),
          "query.startTimeMax": new Date(Date.now() + 60000).toISOString(),
          "query.searchDepth": "10",
        });
        const response = await fetch(
          `http://localhost:16686/api/v3/traces?${query}`,
        );
        const result = await response.json();
        traces = result.result?.resourceSpans || [];
        // Jaeger 2.22 returns OTLP JSON, with spans grouped by resource rather
        // than by trace. Verify the actual worker-client/coordinator-server
        // parent relationship instead of accepting two unrelated spans.
        const spans = traces.flatMap((resource) => {
          const service = resource.resource?.attributes?.find(
            (attribute) => attribute.key === "service.name",
          )?.value?.stringValue;
          return (resource.scopeSpans || []).flatMap((scope) =>
            (scope.spans || []).map((span) => ({ ...span, service })),
          );
        });
        linkedRPC = spans.some(
          (root) =>
            root.service === "peerscreen-worker" &&
            root.name === "process_video_attempt" &&
            spans.some(
              (client) =>
                client.service === "peerscreen-worker" &&
                client.traceId === root.traceId &&
                client.parentSpanId === root.spanId &&
                spans.some(
                  (server) =>
                    server.service === "peerscreen-coordinator" &&
                    server.traceId === client.traceId &&
                    server.parentSpanId === client.spanId,
                ),
            ),
        );
        await writeFile(
          ".local/evidence/operations-trace-diagnostic.json",
          JSON.stringify(
            {
              status: response.status,
              services: [...new Set(spans.map((span) => span.service))],
              traceCount: new Set(spans.map((span) => span.traceId)).size,
              operations: [...new Set(spans.map((span) => span.name))],
              workerRPCLinkedToCoordinator: linkedRPC,
            },
            null,
            2,
          ),
        );
        return response.ok && linkedRPC;
      },
      "Real worker/coordinator trace unavailable",
      30000,
    );
    const serialized = JSON.stringify(traces);
    assert.equal(
      serialized.includes(password),
      false,
      "Trace contains a private password",
    );
    assert.equal(
      serialized.includes(email),
      false,
      "Trace contains an account email",
    );
    operatorEvidence = {
      scrapedReplicas: replicaCount,
      grafanaPanels: panelCount,
      realWorkerCoordinatorTrace: linkedRPC,
      jaegerQueryAPI: "v3",
      traceHasEmailOrPassword: false,
      syntheticRequestLoad: false,
    };
  }
  const listing = await compose(
    ["--profile", "app", "ps", "--format", "json", "api"],
    { test: true, overlays, quiet: true },
  );
  const pods = listing.trim().startsWith("[")
    ? JSON.parse(listing)
    : listing
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
  assert.equal(pods.length, 2);
  const privateMetrics = await compose(
    [
      "exec",
      "-T",
      "web",
      "node",
      "-e",
      "fetch('http://api:8080/metrics').then(r=>r.text()).then(v=>process.stdout.write(v))",
    ],
    { test: true, overlays, quiet: true },
  );
  assert.ok(
    privateMetrics.includes("peerscreen_http_request_duration_seconds_bucket"),
  );
  browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const contexts = await Promise.all([
    browser.newContext({ ignoreHTTPSErrors: true }),
    browser.newContext({ ignoreHTTPSErrors: true }),
  ]);
  const pages = await Promise.all(contexts.map((ctx) => ctx.newPage()));
  async function play(page) {
    const failed = [];
    page.on("response", (response) => {
      if (response.status() >= 400)
        failed.push({
          path: new URL(response.url()).pathname,
          status: response.status(),
        });
    });
    await page.goto(`${origin}/watch/?v=${upload.video_id}`);
    await page
      .getByTestId("player-status")
      .filter({ hasText: "Ready to play" })
      .waitFor()
      .catch(async (error) => {
        await page.screenshot({
          path: ".local/evidence/gateway-player-failure.png",
          fullPage: true,
        });
        console.log(
          JSON.stringify({
            failed: failed.slice(-10),
            headings: await page
              .getByRole("main")
              .getByRole("heading")
              .allTextContents(),
            playbackError: await page
              .getByTestId("playback-error")
              .allTextContents(),
          }),
        );
        throw error;
      });
    await page.getByRole("checkbox", { name: "Help share this video" }).check();
    await page.getByLabel("Video quality").selectOption("480");
    await page.getByText("Connection details", { exact: true }).click();
    await page.locator("video").evaluate((element) => {
      element.muted = true;
      void element.play();
    });
  }
  await play(pages[0]);
  await pages[0].locator("video").evaluate((element) => element.pause());
  await play(pages[1]);
  await until(
    async () =>
      Number(await pages[1].getByTestId("peer-bytes").innerText()) > 0,
    "TLS tracker did not carry real peer discovery/media",
    25000,
  );
  const peerBytes = Number(
    await pages[1].getByTestId("peer-bytes").innerText(),
  );
  const uploadedBytes = Number(
    await pages[0].getByTestId("uploaded-bytes").innerText(),
  );
  assert.ok(uploadedBytes > 0);
  assert.equal(
    Number(await pages[1].getByTestId("rejected-segments").innerText()),
    0,
  );
  assert.equal(await pages[1].evaluate(() => window.isSecureContext), true);
  await browser.close();
  browser = null;
  const healthBefore = await (
    await fetch("http://localhost:19901/stats?filter=membership&format=json")
  ).json();
  console.log(JSON.stringify({ gatewayHealthBefore: healthBefore.stats }));
  await run("docker", ["stop", pods[0].ID]);
  await until(
    async () => {
      const r = await call(secure, origin, "/api/v1/me");
      return (
        r.status() === 200 &&
        r.headers()["x-peerscreen-replica"] !== pods[0].ID.slice(0, 12)
      );
    },
    "Healthy replica did not retain the session",
    15000,
  );
  await until(
    async () => {
      const response = await fetch(
        "http://localhost:19901/stats?filter=cluster.catalogue.membership_healthy&format=json",
      );
      const value = await response.json();
      return value.stats.some(
        (stat) =>
          stat.name === "cluster.catalogue.membership_healthy" &&
          Number(stat.value) === 1,
      );
    },
    "Gateway did not remove the unhealthy endpoint",
    15000,
  ).catch(async (error) => {
    const last = await (
      await fetch("http://localhost:19901/stats?filter=membership&format=json")
    ).json();
    console.log(JSON.stringify({ gatewayHealthAfter: last.stats }));
    throw error;
  });
  for (let index = 0; index < 6; index++) {
    const r = await call(secure, origin, "/api/v1/me");
    assert.equal(r.status(), 200);
    assert.equal((await r.json()).user.id, me.user.id);
  }
  const admin = await fetch("http://localhost:19901/stats/prometheus");
  const stats = await admin.text();
  assert.ok(stats.includes("envoy_cluster_membership_healthy"));
  const record = {
    checkedAt: new Date().toISOString(),
    scope:
      "actual Docker images, self-signed localhost HTTPS/WSS, two replicas, owned upload; STUN offline in rehearsal",
    apiReplicasObserved: replicas.size,
    sharedSession: true,
    secureCookieAttributes: true,
    publicRegistrationClosed: true,
    httpsMedia: true,
    wssTracker: true,
    peerBytes,
    uploadedBytes,
    secureContext: true,
    metricsPrivate: true,
    healthyReplicaAfterStop: true,
    awsResourcesCreated: 0,
    publicDeployment: false,
    ...(operatorEvidence ? { operations: operatorEvidence } : {}),
  };
  await mkdir(".local/evidence", { recursive: true });
  await writeFile(
    operations
      ? ".local/evidence/phase-5-operations.json"
      : ".local/evidence/phase-5-gateway.json",
    JSON.stringify(record, null, 2) + "\n",
  );
  console.log(JSON.stringify(record));
} finally {
  await browser?.close();
  await initial?.dispose();
  await secure?.dispose();
  await rm(directory, { recursive: true, force: true });
  await compose(["--profile", "app", "down", "--volumes"], {
    test: true,
    overlays,
    quiet: true,
  });
}
