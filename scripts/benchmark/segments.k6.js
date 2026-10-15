import http from "k6/http";
import { check, sleep } from "k6";
import crypto from "k6/crypto";
import { Rate, Counter, Trend } from "k6/metrics";
const fixture = JSON.parse(
  open("../../.local/benchmark/media/delivery-fixture.json"),
);
const clients = Number(__ENV.CLIENTS || 25),
  seconds = Number(__ENV.SECONDS || 30);
if (
  ![1, 25, 50, 100].includes(clients) ||
  ![10, 30, 60].includes(seconds) ||
  fixture.closedAt
)
  throw Error("Use a bounded prepared media experiment");
const stream = fixture.streams.find((s) => s.quality === 480),
  failures = new Rate("segment_failure_rate"),
  late = new Rate("segment_late_rate"),
  payload = new Counter("verified_payload_bytes"),
  loaded = new Counter("verified_segments"),
  latency = new Trend("verified_segment_ms", true);
export const options = {
  scenarios: {
    segments: {
      executor: "constant-vus",
      vus: clients,
      duration: seconds + "s",
      gracefulStop: "8s",
    },
  },
  summaryTrendStats: ["avg", "med", "min", "max", "p(95)", "p(99)"],
  systemTags: ["status", "method", "name", "expected_response", "scenario"],
  thresholds: {
    segment_failure_rate: ["rate<0.01"],
    segment_late_rate: ["rate<0.01"],
    verified_segment_ms: ["p(95)<2000"],
    data_received: [
      {
        threshold: "count<" + Number(__ENV.BYTE_BUDGET || 1073741824),
        abortOnFail: true,
        delayAbortEval: "5s",
      },
    ],
  },
};
export default function () {
  const segment = stream.segments[(__ITER + __VU) % stream.segments.length],
    start = Date.now(),
    r = http.get(segment.url, {
      responseType: "binary",
      headers: { ...fixture.headers, "Cache-Control": "no-cache" },
      tags: { name: "480p_segment" },
      timeout: "8s",
    });
  let valid = false;
  try {
    valid =
      r.status === 200 &&
      r.body.byteLength === segment.bytes &&
      crypto.sha256(r.body, "hex") === segment.sha256;
  } catch {}
  const elapsed = Date.now() - start;
  failures.add(!valid);
  late.add(elapsed > segment.durationSeconds * 1000);
  check(r, { "200 and full SHA-256 payload match": () => valid });
  if (valid) {
    payload.add(r.body.byteLength);
    loaded.add(1);
    latency.add(elapsed);
  }
  sleep(Math.max(0, (segment.durationSeconds * 1000 - elapsed) / 1000));
}
export function handleSummary(data) {
  return {
    [__ENV.SUMMARY]: JSON.stringify(
      {
        metadata: {
          scope:
            (fixture.temporaryPublic
              ? "Anonymous public"
              : "Authenticated owner-only") +
            " paced HLS segment clients; no page, decoding, audio or peer exchange",
          clients,
          seconds,
          quality: 480,
          sourceRelease: fixture.release,
          sourceSHA256: fixture.sourceSHA256,
        },
        ...data,
      },
      null,
      2,
    ),
  };
}
