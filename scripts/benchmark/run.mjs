import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { ensureK6 } from "./tools.mjs";
import {
  execute,
  sshOptions,
  hostTarget,
  hostCommand,
  privateError,
} from "./host.mjs";
const campaign = process.argv[2] || "baseline";
const smoke = process.argv.includes("--smoke");
if (!/^[a-z0-9-]{1,40}$/.test(campaign))
  throw Error("Use a short report label");
const root = resolve(".local/benchmark/runs", campaign);
await mkdir(resolve(".local/benchmark/runs"), { recursive: true, mode: 0o700 });
await mkdir(root, { mode: 0o700 }); // Refuse to overwrite another campaign's raw evidence.
const dataset = JSON.parse(
  await readFile(".local/benchmark/dataset.json", "utf8"),
);
const maxBytes = 3 * 1024 ** 3;
let bytes = 0,
  tunnel,
  sampler;
const results = [];
async function profile(label, rate, seconds = 60, mode = "mixed") {
  if (bytes > maxBytes - 32 * 1024 ** 2)
    throw Error("Campaign traffic budget reached");
  const directory = join(root, label);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const binary = await ensureK6();
  const env = {
    ...process.env,
    K6_NO_USAGE_REPORT: "true",
    K6_NO_COLOR: "true",
    RATE: String(rate),
    DURATION: seconds + "s",
    MODE: mode,
    SUMMARY: join(directory, "summary.json"),
    SOURCE_RELEASE: dataset.release,
    BYTE_BUDGET: String(maxBytes - bytes),
  };
  const log = createWriteStream(join(directory, "runner.log"), { mode: 0o600 });
  const status = await new Promise((accept, reject) => {
    const child = spawn(
      "/usr/bin/time",
      [
        "-q",
        "-f",
        '{"userSeconds":%U,"systemSeconds":%S,"elapsedSeconds":%e,"maxRSSKiB":%M,"exitCode":%x}',
        "-o",
        join(directory, "generator.json"),
        binary,
        "run",
        "--quiet",
        "scripts/benchmark/catalogue.k6.js",
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on("error", reject);
    child.on("exit", (code) => {
      log.end();
      accept(code);
    });
  });
  if (![0, 99].includes(status))
    throw Error(
      "Load generator did not finish normally; inspect its private log",
    );
  const report = JSON.parse(
      await readFile(join(directory, "summary.json"), "utf8"),
    ),
    m = report.metrics;
  bytes += m.data_received.values.count;
  const durationMS = report.state.testRunDurationMs;
  const result = {
    label,
    mode,
    rate,
    requestedDurationSeconds: seconds,
    successfulThresholds: status === 0,
    operations: m.operations_total?.values.count || 0,
    completedOperationsPerScenarioSecond:
      (m.operations_total?.values.count || 0) / seconds,
    wholeRunOperationsPerSecond: m.operations_total?.values.rate || 0,
    failureRate: m.operation_failures?.values.rate || 0,
    dropped: m.dropped_iterations?.values.count || 0,
    p95MS: m.success_latency_ms?.values["p(95)"],
    p99MS: m.success_latency_ms?.values["p(99)"],
    receivedBytes: m.data_received.values.count,
    runDurationMS: durationMS,
  };
  results.push(result);
  await writeFile(
    join(root, "campaign.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        campaign,
        dataset,
        k6: "1.8.2",
        scriptSHA256: createHash("sha256")
          .update(await readFile("scripts/benchmark/catalogue.k6.js"))
          .digest("hex"),
        receivedBytes: bytes,
        results,
        candidateOperationsPerSecond:
          results
            .filter(
              (r) =>
                r.label.startsWith("step-") &&
                r.successfulThresholds &&
                r.completedOperationsPerScenarioSecond >= r.rate * 0.98,
            )
            .at(-1)?.rate || 0,
        confirmedSteadyOperationsPerSecond:
          results.filter((r) => r.label.startsWith("steady-")).length === 3 &&
          results
            .filter((r) => r.label.startsWith("steady-"))
            .every(
              (r) =>
                r.successfulThresholds &&
                r.completedOperationsPerScenarioSecond >= r.rate * 0.98,
            )
            ? results.find((r) => r.label === "steady-1").rate
            : 0,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
  return result;
}
try {
  const target = await hostTarget();
  tunnel = spawn(
    "ssh",
    [
      ...sshOptions,
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=15",
      "-N",
      "-L",
      "127.0.0.1:38443:127.0.0.1:38443",
      target,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const healthArgs = [
    "--fail",
    "--silent",
    "--show-error",
    "--max-time",
    "3",
    "--resolve",
    "peerscreen.darshpatel.dev:38443:127.0.0.1",
    "https://peerscreen.darshpatel.dev:38443/health/ready",
  ];
  let ready = false;
  for (let i = 0; i < 20; i++) {
    try {
      await execute("curl", healthArgs);
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!ready) throw Error("Private benchmark HTTPS route is not ready");
  await execute("scp", [
    ...sshOptions,
    "scripts/benchmark/sample-host.py",
    target + ":/home/ubuntu/peerscreen-benchmark/sample-host.py",
  ]);
  const stats = createWriteStream(join(root, "resources.jsonl"), {
    mode: 0o600,
  });
  sampler = spawn(
    "ssh",
    [
      ...sshOptions,
      target,
      "sudo timeout 1800 python3 /home/ubuntu/peerscreen-benchmark/sample-host.py",
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  sampler.stdout.pipe(stats);
  let accepted = 0;
  for (const rate of smoke ? [5] : [25, 50, 100, 200, 400, 800, 1200]) {
    const result = await profile("step-" + rate, rate, smoke ? 10 : 60);
    if (
      !result.successfulThresholds ||
      result.completedOperationsPerScenarioSecond < rate * 0.98
    )
      break;
    accepted = rate;
  }
  if (accepted && !smoke) {
    for (let i = 1; i <= 3; i++) await profile("steady-" + i, accepted, 120);
    await profile("spike", Math.min(1200, accepted * 4), 30);
    await profile("recovery", Math.min(25, accepted), 60);
  }
  if (!smoke) {
    await profile("analytics-cache", 10, 60, "analytics-cache");
    await profile("analytics-fresh", 10, 60, "analytics-fresh");
  }
  console.log(
    "Campaign complete; raw summaries, generator use and cgroup samples are retained privately.",
  );
} catch (e) {
  await privateError("campaign-error.txt", e);
} finally {
  tunnel?.kill("SIGTERM");
  sampler?.kill("SIGTERM");
}
