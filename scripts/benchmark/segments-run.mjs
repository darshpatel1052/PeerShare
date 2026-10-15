import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ensureK6 } from "./tools.mjs";
import { snapshot } from "./metrics.mjs";
import { sshOptions, hostTarget, execute, privateError } from "./host.mjs";
const label = process.argv[2] || "segments-v1";
if (!/^[a-z0-9-]{1,40}$/.test(label))
  throw Error("Use a unique campaign label");
const root = resolve(".local/benchmark/media", label);
await mkdir(root, { mode: 0o700 });
let sampler;
try {
  const fixture = JSON.parse(
    await readFile(".local/benchmark/media/delivery-fixture.json", "utf8"),
  );
  const target = await hostTarget();
  await execute("scp", [
    ...sshOptions,
    "scripts/benchmark/sample-host.py",
    target + ":/home/ubuntu/peerscreen-benchmark/sample-host.py",
  ]);
  sampler = spawn(
    "ssh",
    [
      ...sshOptions,
      target,
      "sudo timeout 600 python3 /home/ubuntu/peerscreen-benchmark/sample-host.py all",
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  sampler.stdout.pipe(
    createWriteStream(join(root, "resources.jsonl"), { mode: 0o600 }),
  );
  let bytes = 0;
  const results = [];
  const binary = await ensureK6();
  for (const clients of [1, 25, 50, 100]) {
    const seconds = clients === 1 ? 10 : 30,
      directory = join(root, "clients-" + clients);
    await mkdir(directory, { mode: 0o700 });
    const before = await snapshot("public"),
      startedAt = new Date().toISOString(),
      log = createWriteStream(join(directory, "runner.log"), { mode: 0o600 });
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
          "scripts/benchmark/segments.k6.js",
        ],
        {
          env: {
            ...process.env,
            K6_NO_USAGE_REPORT: "true",
            K6_NO_COLOR: "true",
            CLIENTS: String(clients),
            SECONDS: String(seconds),
            SUMMARY: join(directory, "summary.json"),
            BYTE_BUDGET: String(1073741824 - bytes),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
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
      throw Error("Segment load generator failed; inspect private runner log");
    const after = await snapshot("public");
    await writeFile(
      join(directory, "server-counters.json"),
      JSON.stringify({ before, after }, null, 2) + "\n",
      { mode: 0o600 },
    );
    const report = JSON.parse(
        await readFile(join(directory, "summary.json"), "utf8"),
      ),
      m = report.metrics;
    bytes += m.data_received.values.count;
    const result = {
      clients,
      seconds,
      startedAt,
      finishedAt: new Date().toISOString(),
      passed: status === 0,
      verifiedSegments: m.verified_segments?.values.count || 0,
      verifiedPayloadBytes: m.verified_payload_bytes?.values.count || 0,
      failureRate: m.segment_failure_rate.values.rate,
      lateRate: m.segment_late_rate.values.rate,
      p95MS: m.verified_segment_ms?.values["p(95)"],
      p99MS: m.verified_segment_ms?.values["p(99)"],
      receivedBytes: m.data_received.values.count,
    };
    results.push(result);
    await writeFile(
      join(root, "campaign.json"),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          scope:
            (fixture.temporaryPublic
              ? "Actual anonymous public"
              : "Actual private owner-authenticated") +
            " 480p HLS segment objects paced by fragment duration, SHA-256 verification; synthetic clients, no video decoding",
          release: fixture.release,
          dnsResolution: process.env.BENCHMARK_DNS_OVERRIDE
            ? "Explicit configured EIP; TLS/SNI hostname verification unchanged"
            : "Public DNS",
          receivedBytes: bytes,
          results,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    console.log(JSON.stringify(result));
    if (status !== 0 || bytes > 1073741824 - 64 * 1024 * 1024) break;
  }
} catch (e) {
  await privateError("segments-error.txt", e);
} finally {
  sampler?.kill("SIGTERM");
}
