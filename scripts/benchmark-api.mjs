import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { availableParallelism, cpus, totalmem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    requests: { type: "string", default: "200" },
    concurrency: { type: "string", default: "8" },
    repeats: { type: "string", default: "3" },
    label: { type: "string", default: "api-benchmark" },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log(
    "npm run benchmark:api -- --base http://localhost:3000 --requests 200 --concurrency 8 --repeats 3",
  );
  process.exit(0);
}
const base = new URL(values.base);
if (
  base.pathname !== "/" ||
  base.search ||
  base.hash ||
  base.username ||
  base.password ||
  !["http:", "https:"].includes(base.protocol) ||
  !["localhost", "127.0.0.1", "peerscreen.darshpatel.dev"].includes(
    base.hostname,
  )
)
  throw Error(
    "Use the local app or the authorized PeerShare production hostname",
  );
const settings = Object.fromEntries(
  ["requests", "concurrency", "repeats"].map((key) => [
    key,
    Number(values[key]),
  ]),
);
if (!/^[a-z0-9-]{1,60}$/.test(values.label))
  throw Error("Use a short lowercase report label");
if (
  !Number.isInteger(settings.requests) ||
  settings.requests < 10 ||
  settings.requests > 2000 ||
  !Number.isInteger(settings.concurrency) ||
  settings.concurrency < 1 ||
  settings.concurrency > 32 ||
  !Number.isInteger(settings.repeats) ||
  settings.repeats < 1 ||
  settings.repeats > 5
)
  throw Error("Use 10–2000 requests, 1–32 concurrent clients and 1–5 repeats");
const url = new URL("/api/v1/videos?limit=12", base);
const initial = await fetch(url, { signal: AbortSignal.timeout(5000) });
if (!initial.ok)
  throw Error("The catalogue must be available before measurement");
const catalogue = await initial.json();
if (!Array.isArray(catalogue.items))
  throw Error("Expected the actual PeerShare catalogue contract");
// The schema-check request is the first warmup request.
for (let i = 1; i < 10; i++) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  await response.arrayBuffer();
  if (!response.ok) throw Error("Warmup failed");
}
const rounds = [];
for (let repeat = 1; repeat <= settings.repeats; repeat++) {
  let next = 0,
    failures = 0,
    payloadBytes = 0;
  const samples = [],
    replicas = new Set();
  const statuses = {},
    errors = {};
  const start = performance.now(),
    deadline = start + 60000;
  await Promise.all(
    Array.from({ length: settings.concurrency }, async () => {
      while (next < settings.requests && performance.now() < deadline) {
        next++;
        const before = performance.now();
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(5000),
            headers: { Accept: "application/json" },
          });
          const bytes = await response.arrayBuffer();
          statuses[response.status] = (statuses[response.status] || 0) + 1;
          if (response.status !== 200) {
            failures++;
            continue;
          }
          const body = JSON.parse(new TextDecoder().decode(bytes));
          if (!Array.isArray(body.items)) throw Error("invalid_contract");
          samples.push(performance.now() - before);
          payloadBytes += bytes.byteLength;
          const replica = response.headers.get("X-PeerScreen-Replica");
          if (replica) replicas.add(replica);
        } catch (error) {
          failures++;
          const name =
            error.name === "TimeoutError"
              ? "timeout"
              : error.message === "invalid_contract"
                ? "invalid_contract"
                : "transport_or_decode";
          errors[name] = (errors[name] || 0) + 1;
        }
      }
    }),
  );
  const elapsed = (performance.now() - start) / 1000;
  samples.sort((a, b) => a - b);
  const percentile = (q) =>
    samples.length
      ? Number(
          samples[Math.max(0, Math.ceil(q * samples.length) - 1)].toFixed(3),
        )
      : null;
  rounds.push({
    repeat,
    attempted: next,
    successful: samples.length,
    failures,
    statuses,
    errors,
    stoppedByDeadline: next < settings.requests,
    elapsedSeconds: Number(elapsed.toFixed(3)),
    successfulRequestsPerSecond: Number((samples.length / elapsed).toFixed(2)),
    successLatencyMS: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
    },
    metadataPayloadBytes: payloadBytes,
    distinctReplicaHeaders: replicas.size,
  });
}
const evidence = {
  checkedAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  workingTreeChanged: !!execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim(),
  scope:
    "Closed-loop catalogue metadata GET requests, full response body consumed and JSON contract checked, warm HTTP connections; separate from video/WebRTC measurement. Client and server share this host for localhost runs.",
  label: values.label,
  latencyDefinition:
    "Wall time through response consumption and JSON validation; successful responses only. Failures and status codes are reported separately.",
  throughputDefinition:
    "Successful requests / entire round wall time; bounded concurrency, not a sustained open-loop capacity test.",
  base: base.origin,
  node: process.version,
  host: {
    cpu: cpus()[0]?.model,
    availableCPUs: availableParallelism(),
    ramBytes: totalmem(),
  },
  dataset: {
    pageItems: catalogue.items.length,
    morePages: !!catalogue.next_cursor,
  },
  warmupRequests: 10,
  ...settings,
  rounds,
};
await mkdir(".local/evidence", { recursive: true });
await writeFile(
  `.local/evidence/${values.label}.json`,
  JSON.stringify(evidence, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(evidence, null, 2));
if (rounds.some((round) => round.failures || round.stoppedByDeadline))
  process.exitCode = 1;
