import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, access, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compose } from "./dependencies.mjs";
import {
  ensureKubernetesTools,
  binaries,
  versions,
} from "./kubernetes-tools.mjs";
const run = promisify(execFile);
const action = process.argv[2] || "up";
if (!["up", "down", "test", "status"].includes(action))
  throw Error("Use up, down, status or test");
const exercise = action === "test";
const cluster = exercise ? "peerscreen-exercise" : "peerscreen-local";
const directory = resolve(".local/kubernetes", exercise ? "exercise" : "local");
const kubeconfig = resolve(directory, "kubeconfig");
const context = `kind-${cluster}`;
const base = "http://localhost:3400";
let created = false;
await mkdir(directory, { recursive: true, mode: 0o700 });
await ensureKubernetesTools();
async function command(binary, args, { timeout = 300000 } = {}) {
  const result = await run(binary, args, {
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, KUBECONFIG: kubeconfig },
  });
  return result.stdout;
}
const kubectl = (args) =>
  command(binaries.kubectl, [
    "--kubeconfig",
    kubeconfig,
    "--context",
    context,
    ...args,
  ]);
async function setup() {
  await access(".local/media/fixture/fixture.json");
  const clusters = (await command(binaries.kind, ["get", "clusters"]))
    .trim()
    .split("\n");
  if (clusters.includes(cluster)) {
    if (exercise)
      throw Error(
        "The disposable exercise cluster already exists; inspect it before starting another exercise",
      );
    await access(resolve(directory, "owner.json"));
  } else {
    const config = {
      kind: "Cluster",
      apiVersion: "kind.x-k8s.io/v1alpha4",
      networking: { apiServerAddress: "127.0.0.1" },
      nodes: [
        {
          role: "control-plane",
          image: versions.node,
          extraMounts: [
            {
              hostPath: resolve(".local/media/fixture"),
              containerPath: "/peerscreen-fixture",
              readOnly: true,
            },
          ],
          extraPortMappings: [
            {
              containerPort: 30080,
              hostPort: 3400,
              listenAddress: "127.0.0.1",
              protocol: "TCP",
            },
          ],
        },
      ],
    };
    await writeFile(
      resolve(directory, "cluster.json"),
      JSON.stringify(config, null, 2),
      { mode: 0o600 },
    );
    console.log("Creating the isolated local kind node.");
    await command(
      binaries.kind,
      [
        "create",
        "cluster",
        "--name",
        cluster,
        "--kubeconfig",
        kubeconfig,
        "--config",
        resolve(directory, "cluster.json"),
        "--wait",
        "120s",
      ],
      { timeout: 480000 },
    );
    created = true;
    await chmod(kubeconfig, 0o600);
    await writeFile(
      resolve(directory, "owner.json"),
      JSON.stringify({
        cluster,
        createdAt: new Date().toISOString(),
        exercise,
      }),
      { mode: 0o600 },
    );
  }
  console.log(
    "Building and loading the application and pinned dependency images.",
  );
  await compose(["--profile", "app", "build", "web", "migrate"], {
    quiet: true,
  });
  // Import only the workspace-built images. Dependency images retain their
  // registry digest references and are pulled by containerd in the kind node.
  await command(
    binaries.kind,
    [
      "load",
      "docker-image",
      "--name",
      cluster,
      "peerscreen-api:local",
      "peerscreen-web:local",
    ],
    { timeout: 480000 },
  );
  const secretFile = resolve(directory, "secrets.json");
  let credentials;
  try {
    credentials = JSON.parse(await readFile(secretFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const hex = () => randomBytes(32).toString("hex");
    const admin = hex(),
      catalog = hex(),
      media = hex(),
      redis = hex(),
      catalogRPC = hex(),
      workerRPC = hex();
    const secret = (name, stringData) => ({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name, namespace: "peerscreen" },
      type: "Opaque",
      stringData,
    });
    credentials = {
      apiVersion: "v1",
      kind: "List",
      items: [
        {
          apiVersion: "v1",
          kind: "Namespace",
          metadata: { name: "peerscreen" },
        },
        secret("peerscreen-database", {
          POSTGRES_PASSWORD: admin,
          CATALOG_DB_PASSWORD: catalog,
          MEDIA_DB_PASSWORD: media,
        }),
        secret("peerscreen-redis", { REDIS_PASSWORD: redis }),
        secret("peerscreen-catalogue", {
          DATABASE_URL: `postgres://peerscreen_catalog:${catalog}@postgres:5432/peerscreen?sslmode=disable`,
          REDIS_URL: `redis://:${redis}@redis:6379/0`,
          ANALYTICS_REDIS_URL: `redis://:${redis}@redis-cache:6379/0`,
          CATALOG_RPC_TOKEN: catalogRPC,
        }),
        secret("peerscreen-coordinator", {
          MEDIA_DATABASE_URL: `postgres://peerscreen_media:${media}@postgres:5432/peerscreen?sslmode=disable`,
          CATALOG_RPC_TOKEN: catalogRPC,
          WORKER_RPC_TOKEN: workerRPC,
        }),
        secret("peerscreen-worker", { WORKER_RPC_TOKEN: workerRPC }),
      ],
    };
    await writeFile(secretFile, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
    });
  }
  await kubectl(["apply", "-f", secretFile]);
  console.log(
    "Applying the Helm chart and waiting for migrations and readiness.",
  );
  await command(
    binaries.helm,
    [
      "upgrade",
      "--install",
      "peerscreen",
      "deploy/helm/peerscreen",
      "--namespace",
      "peerscreen",
      "--kubeconfig",
      kubeconfig,
      "--kube-context",
      context,
      "--wait",
      "--wait-for-jobs",
      "--timeout",
      "300s",
    ],
    { timeout: 360000 },
  );
}
async function verify() {
  const started = Date.now();
  let cookie = "";
  async function call(path, { method = "GET", body, raw, headers = {} } = {}) {
    const response = await fetch(base + path, {
      method,
      signal: AbortSignal.timeout(15000),
      headers: {
        Origin: base,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body || raw
          ? {
              "Content-Type": raw
                ? "application/octet-stream"
                : "application/json",
            }
          : {}),
        ...headers,
      },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    const data = (response.headers.get("content-type") || "").includes(
      "application/json",
    )
      ? await response.json()
      : null;
    return { status: response.status, data, response };
  }
  const registration = await call("/api/v1/auth/register", {
    method: "POST",
    body: {
      email: `kind-${randomUUID()}@example.test`,
      password: randomBytes(24).toString("hex"),
      display_name: "Kubernetes creator",
    },
  });
  assert.equal(registration.status, 201);
  cookie = registration.response.headers.getSetCookie()[0].split(";")[0];
  const channel = await call("/api/v1/channels", {
    method: "POST",
    body: {
      handle: `kind-${randomUUID().slice(0, 8)}`,
      title: "Kubernetes exercise",
      description: "Local isolated chart verification",
    },
  });
  assert.equal(channel.status, 201);
  const source = resolve(directory, "source.mp4");
  await command("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
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
  const upload = await call("/api/v1/uploads", {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: {
      channel_id: channel.data.id,
      title: "Kind upload",
      description: "Actual worker output from the local chart",
      tags: [],
      size: payload.length,
      part_checksums: [createHash("sha256").update(payload).digest("hex")],
    },
  });
  assert.equal(upload.status, 201);
  const grant = await call(`/api/v1/uploads/${upload.data.id}/parts/presign`, {
    method: "POST",
    body: { numbers: [1] },
  });
  assert.equal(grant.status, 200);
  assert.equal(
    (
      await call(`/api/v1/uploads/${upload.data.id}/parts/1`, {
        method: "PUT",
        raw: payload,
        headers: { "Upload-Token": grant.data.parts[0].token },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(`/api/v1/uploads/${upload.data.id}/complete`, {
        method: "POST",
      })
    ).status,
    202,
  );
  let prepared = false;
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    const current = await call(`/api/v1/uploads/${upload.data.id}`);
    if (current.data.processing_state === "ready") {
      prepared = true;
      break;
    }
    if (current.data.processing_state === "failed")
      throw Error("The local chart worker could not prepare its fixture");
    await new Promise((accept) => setTimeout(accept, 500));
  }
  assert.ok(prepared, "Actual Kubernetes processing did not finish");
  assert.equal(
    (
      await call(`/api/v1/videos/${upload.data.video_id}/publish`, {
        method: "POST",
      })
    ).status,
    200,
  );
  const video = await call(`/api/v1/videos/${upload.data.video_id}`);
  assert.deepEqual(video.data.qualities, [480, 720]);
  const manifest = await fetch(video.data.playback.manifest_url);
  assert.equal(manifest.status, 200);
  assert.ok((await manifest.text()).includes("#EXTM3U"));
  const replicas = new Set();
  for (let i = 0; i < 12; i++) {
    const response = await call("/api/v1/me");
    assert.equal(response.status, 200);
    replicas.add(response.response.headers.get("X-PeerScreen-Replica"));
  }
  assert.equal(replicas.size, 2);
  console.log(
    "Real upload, processing, publication and shared sessions passed. Scaling API from two to three pods.",
  );
  await kubectl([
    "-n",
    "peerscreen",
    "scale",
    "deployment",
    "api",
    "--replicas=3",
  ]);
  await kubectl([
    "-n",
    "peerscreen",
    "rollout",
    "status",
    "deployment/api",
    "--timeout=90s",
  ]);
  let ready = [];
  const scaleEnd = Date.now() + 30000;
  while (Date.now() < scaleEnd) {
    const slices = JSON.parse(
      await kubectl([
        "-n",
        "peerscreen",
        "get",
        "endpointslices",
        "-l",
        "kubernetes.io/service-name=api",
        "-o",
        "json",
      ]),
    );
    ready = slices.items
      .flatMap((slice) => slice.endpoints)
      .filter((endpoint) => endpoint.conditions.ready === true);
    if (ready.length === 3) break;
    await new Promise((accept) => setTimeout(accept, 500));
  }
  assert.equal(ready.length, 3);
  const scaled = new Set();
  const discoveryStarted = Date.now();
  while (Date.now() - discoveryStarted < 30000 && scaled.size < 3) {
    const response = await call("/api/v1/me");
    assert.equal(response.status, 200);
    scaled.add(response.response.headers.get("X-PeerScreen-Replica"));
    if (scaled.size < 3) await new Promise((accept) => setTimeout(accept, 200));
  }
  assert.equal(scaled.size, 3);
  assert.equal((await call("/metrics")).status, 404);
  const evidence = {
    checkedAt: new Date().toISOString(),
    scope:
      "Disposable single-node local kind cluster, real Helm chart and images; no AWS Kubernetes resources",
    versions,
    verificationElapsedSeconds: (Date.now() - started) / 1000,
    realUpload: true,
    realTranscode: true,
    renditions: video.data.qualities,
    publicManifestRead: true,
    sharedSession: true,
    apiReplicasObserved: replicas.size,
    scaledReadyEndpoints: ready.length,
    scaledReplicasObserved: scaled.size,
    gatewayDiscoveryMS: Date.now() - discoveryStarted,
    privateMetrics: true,
    multiNodeAvailability: false,
    crossNetworkPeerValidation: false,
  };
  await mkdir(".local/evidence", { recursive: true, mode: 0o700 });
  await writeFile(
    ".local/evidence/phase-6-kubernetes.json",
    JSON.stringify(evidence, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(evidence));
}
try {
  if (action === "up" || exercise) {
    await setup();
    if (exercise) await verify();
    else
      console.log(
        `PeerScreen kind: ${base}. Private kubeconfig: ${kubeconfig}`,
      );
  } else {
    await access(resolve(directory, "owner.json"));
    if (action === "status")
      console.log(await kubectl(["-n", "peerscreen", "get", "pods"]));
    else await command(binaries.kind, ["delete", "cluster", "--name", cluster]);
  }
} catch (error) {
  console.error(error.message);
  if (created) {
    const diagnostic = { error: error.message, details: error.stderr || "" };
    for (const [name, args] of Object.entries({
      pods: ["-n", "peerscreen", "get", "pods", "-o", "wide"],
      events: ["-n", "peerscreen", "get", "events", "--sort-by=.lastTimestamp"],
      bootstrap: [
        "-n",
        "peerscreen",
        "logs",
        "job/peerscreen-bootstrap-1",
        "--all-containers=true",
      ],
    })) {
      try {
        diagnostic[name] = await kubectl(args);
      } catch (cause) {
        diagnostic[name] = cause.stderr || cause.message;
      }
    }
    await writeFile(
      resolve(directory, "diagnostic.json"),
      JSON.stringify(diagnostic, null, 2),
      { mode: 0o600 },
    );
  }
  if (created)
    console.error(
      "The local cluster failed; private diagnostic state is retained under .local/kubernetes.",
    );
  process.exitCode = 1;
} finally {
  if (exercise && created) {
    await command(binaries.kind, ["delete", "cluster", "--name", cluster]);
    console.log(
      "Removed the disposable exercise cluster; normal app data is preserved.",
    );
  }
}
