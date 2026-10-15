import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";
import crypto from "k6/crypto";
const rate = Number(__ENV.RATE || 25),
  duration = __ENV.DURATION || "60s",
  mode = __ENV.MODE || "mixed";
if (
  !Number.isInteger(rate) ||
  rate < 1 ||
  rate > 1500 ||
  !/^\d+s$/.test(duration) ||
  Number(duration.slice(0, -1)) > 180
)
  throw Error("Bounded rate and duration required");
const base = "https://peerscreen.darshpatel.dev:38443";
const members = new SharedArray("synthetic members", () =>
  JSON.parse(open("../../.local/benchmark/users.json")),
);
const operations = new Counter("operations_total"),
  failures = new Rate("operation_failures"),
  latency = new Trend("success_latency_ms", true),
  allLatency = new Trend("operation_latency_ms", true);
const statuses = Object.fromEntries(
  ["ok_200", "rate_limited_429", "server_5xx", "transport", "other_http"].map(
    (name) => [name, new Counter("responses_" + name)],
  ),
);
export const options = {
  hosts: { "peerscreen.darshpatel.dev": "127.0.0.1" },
  scenarios: {
    load: {
      executor: "constant-arrival-rate",
      rate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: Math.min(512, Math.max(64, Math.ceil(rate * 0.5))),
      maxVUs: 512,
      gracefulStop: "8s",
    },
  },
  systemTags: [
    "status",
    "method",
    "name",
    "scenario",
    "expected_response",
    "proto",
    "tls_version",
  ],
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  thresholds: {
    operation_failures: ["rate<0.01"],
    success_latency_ms: ["p(95)<250", "p(99)<500"],
    dropped_iterations: ["count==0"],
    checks: ["rate>0.99"],
    data_received: [
      {
        threshold: `count<${Number(__ENV.BYTE_BUDGET || 536870912)}`,
        abortOnFail: true,
        delayAbortEval: "5s",
      },
    ],
    ...Object.fromEntries(
      [
        "search",
        "catalogue_cursor",
        "catalogue_first",
        "channel_feed",
        "video_detail",
        "following",
        "playlist",
        "analytics",
        "analytics-cache",
        "analytics-fresh",
      ].map((name) => [`operation_latency_ms{endpoint:${name}}`, ["max>=0"]]),
    ),
  },
};
const id = (kind, i) => {
  const s = crypto.md5(`benchmark:${kind}:${i}`, "hex");
  return (
    s.slice(0, 8) +
    "-" +
    s.slice(8, 12) +
    "-" +
    s.slice(12, 16) +
    "-" +
    s.slice(16, 20) +
    "-" +
    s.slice(20)
  );
};
export function setup() {
  let cursor = "";
  for (let i = 0; i < 10; i++) {
    const r = http.get(base + "/api/v1/videos?limit=12", {
      tags: { name: "warmup" },
      timeout: "5s",
    });
    if (r.status !== 200) throw Error("Catalogue is not ready");
    cursor = r.json("next_cursor");
    if (!cursor) throw Error("Expected the large benchmark dataset");
  }
  return { cursor };
}
export default function (data) {
  const member = members[Math.floor(Math.random() * members.length)],
    sample = 1 + Math.floor(Math.random() * 100000),
    pick = Math.random();
  let name, path;
  if (mode === "analytics-cache" || mode === "analytics-fresh") {
    name = mode;
    path = `/channels/${members[0].channelID}/analytics`;
  } else if (mode === "search" || (mode === "mixed" && pick < 0.2)) {
    name = "search";
    const terms = [
      "PostgreSQL",
      "WebRTC",
      "practical introduction",
      "queues",
      "Go",
      "missing-term-9zz",
    ];
    path =
      "/videos?limit=12&q=" +
      encodeURIComponent(terms[Math.floor(Math.random() * terms.length)]);
  } else if (mode === "catalogue" || pick < 0.5) {
    const cursor = Math.random() < 0.4;
    name = cursor ? "catalogue_cursor" : "catalogue_first";
    path =
      "/videos?limit=12" +
      (cursor ? "&cursor=" + encodeURIComponent(data.cursor) : "");
  } else if (pick < 0.65) {
    name = "channel_feed";
    path =
      "/videos?limit=12&channel_id=" +
      id("channel", 1 + Math.floor(Math.random() * 1000));
  } else if (pick < 0.8) {
    name = "video_detail";
    path = "/videos/" + id("video", sample);
  } else if (pick < 0.9) {
    name = "following";
    path = "/videos?feed=following&limit=12";
  } else if (pick < 0.95) {
    name = "playlist";
    path = "/playlists/" + member.playlistID;
  } else {
    name = "analytics";
    path = "/channels/" + member.channelID + "/analytics";
  }
  const actor = mode.startsWith("analytics-") ? members[0] : member;
  const started = Date.now(),
    r = http.get(base + "/api/v1" + path, {
      headers: {
        Cookie: "__Host-peerscreen_session=" + actor.token,
        ...(mode === "analytics-fresh" ? { "Cache-Control": "no-cache" } : {}),
      },
      tags: { name },
      timeout: "5s",
    });
  let valid = false;
  try {
    const body = r.json();
    valid =
      r.status === 200 &&
      (name === "video_detail"
        ? typeof body.id === "string" && Array.isArray(body.qualities)
        : name.includes("analytics")
          ? !!body.totals
          : Array.isArray(body.items));
  } catch {}
  const elapsed = Date.now() - started;
  const statusGroup =
    r.status === 200
      ? "ok_200"
      : r.status === 429
        ? "rate_limited_429"
        : r.status >= 500
          ? "server_5xx"
          : r.status === 0
            ? "transport"
            : "other_http";
  for (const [name, counter] of Object.entries(statuses))
    counter.add(Number(name === statusGroup));
  operations.add(1, { endpoint: name });
  failures.add(!valid, { endpoint: name });
  allLatency.add(elapsed, { endpoint: name });
  if (valid) latency.add(elapsed, { endpoint: name });
  check(
    r,
    { "200 and correct response contract": () => valid },
    { endpoint: name },
  );
}
export function handleSummary(data) {
  return {
    [__ENV.SUMMARY]: JSON.stringify(
      {
        metadata: {
          mode,
          offeredOperationsPerSecond: rate,
          duration,
          sourceRelease: __ENV.SOURCE_RELEASE,
          dataset:
            "100000 metadata videos / 10000 synthetic accounts / 1000 channels",
          transport:
            "Verified TLS through one SSH tunnel; no public benchmark ingress",
        },
        ...data,
      },
      null,
      2,
    ),
  };
}
