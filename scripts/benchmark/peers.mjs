import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { cpus, totalmem } from "node:os";
import { snapshot } from "./metrics.mjs";
import { privateError } from "./host.mjs";
const label = process.argv[2] || "peers-v1";
if (!/^[a-z0-9-]{1,40}$/.test(label))
  throw Error("Use a unique measurement label");
const root = resolve(".local/benchmark/media", label);
await mkdir(root, { mode: 0o700 });
const fixture = JSON.parse(
  await readFile(
    process.env.PEER_FIXTURE_KIND === "showcase"
      ? ".local/benchmark/media/peer-fixture.json"
      : ".local/benchmark/media/delivery-fixture.json",
    "utf8",
  ),
);
if (
  (!fixture.temporaryPublic && fixture.access !== "existing-public") ||
  fixture.durationSeconds < 30 ||
  fixture.durationSeconds > 32
)
  throw Error(
    "Approved temporary or existing public 30–32 second clip required",
  );
const report = {
  checkedAt: null,
  release: fixture.release,
  videoID: fixture.videoID,
  sourceSHA256: fixture.sourceSHA256,
  fixture,
  scriptSHA256: createHash("sha256")
    .update(await readFile(new URL(import.meta.url)))
    .digest("hex"),
  scope:
    "Real public AWS HTTPS/WSS; eight independent Chromium contexts on one external Linux workstation; full fixed-clip 480p playback per viewer; three HTTP/peer pairs; no independent-network claim",
  client: {
    cpu: cpus()[0].model,
    logicalCPUs: cpus().length,
    ramBytes: totalmem(),
  },
  metricDefinition:
    "Go media-route response-body counter, summed across two public API replicas, including partial responses, manifest/descriptor bodies and every public media request during the window; excludes HTTP/TLS overhead and other paths. Quiet demo site; unrelated media traffic could inflate a window.",
  rounds: [],
};
const save = () =>
  writeFile(
    join(root, "peer-comparison.json"),
    JSON.stringify(
      { ...report, checkedAt: new Date().toISOString() },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
function mediaBytes(s) {
  return Object.entries(s.counters)
    .filter(
      ([k]) =>
        k.startsWith("peerscreen_http_response_body_bytes_total{") &&
        k.includes('route="GET /api/v1/media/{key...}"'),
    )
    .reduce((n, [, v]) => n + v, 0);
}
async function sample(page) {
  const number = async (id) => Number(await page.getByTestId(id).innerText());
  return {
    httpBytes: await number("http-bytes"),
    peerBytes: await number("peer-bytes"),
    uploadedBytes: await number("uploaded-bytes"),
    verifiedSegments: await number("verified-segments"),
    rejectedSegments: await number("rejected-segments"),
    ...(await page.locator("video").evaluate((v) => ({
      playhead: v.currentTime,
      duration: v.duration,
      width: v.videoWidth,
      height: v.videoHeight,
      ended: v.ended,
      totalFrames: v.getVideoPlaybackQuality().totalVideoFrames,
      droppedFrames: v.getVideoPlaybackQuality().droppedVideoFrames,
    }))),
  };
}
let browser;
try {
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  for (let repeat = 1; repeat <= 3; repeat++)
    for (const assisted of [false, true]) {
      const contexts = await Promise.all(
          Array.from({ length: 8 }, () =>
            browser.newContext({ viewport: { width: 1000, height: 800 } }),
          ),
        ),
        pages = await Promise.all(contexts.map((c) => c.newPage()));
      try {
        for (const p of pages) {
          const cdp = await p.context().newCDPSession(p);
          await cdp.send("Network.enable");
          await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
        }
        const setupBefore = await snapshot("public");
        if (assisted)
          for (const p of pages) {
            await p.goto(fixture.watchURL);
            await expect(p.getByTestId("player-status")).toHaveText(
              "Ready to play",
              { timeout: 20000 },
            );
            await p
              .getByRole("checkbox", { name: "Help share this video" })
              .check();
            await expect(
              p.getByRole("checkbox", { name: "Help share this video" }),
            ).toBeChecked();
            await p.goto("about:blank");
          }
        if (assisted) await new Promise((r) => setTimeout(r, 1000));
        const before = await snapshot("public"),
          setupBodyBytes = mediaBytes(before) - mediaBytes(setupBefore),
          started = Date.now();
        async function start(p) {
          await p.goto(fixture.watchURL);
          await expect(p.getByTestId("player-status")).toHaveText(
            "Ready to play",
            { timeout: 20000 },
          );
          await expect(
            p.getByRole("checkbox", { name: "Help share this video" }),
          ).toBeChecked({ checked: assisted });
          await p.getByText("Connection details", { exact: true }).click();
          await p.getByLabel("Video quality").selectOption("480");
          await p.locator("video").evaluate((v) => {
            v.muted = true;
            void v.play();
          });
          await expect
            .poll(() => p.locator("video").evaluate((v) => v.currentTime), {
              timeout: 20000,
            })
            .toBeGreaterThan(1);
        }
        await start(pages[0]);
        await expect
          .poll(
            () => pages[0].locator("video").evaluate((v) => v.currentTime),
            { timeout: 10000 },
          )
          .toBeGreaterThan(4);
        await Promise.all(pages.slice(1).map(start));
        await Promise.all(
          pages.map((p) =>
            expect
              .poll(() => p.locator("video").evaluate((v) => v.currentTime), {
                timeout: 90000,
              })
              .toBeGreaterThan(
                (fixture.actualHLSDurationSeconds ||
                  fixture.streams
                    .find((s) => s.quality === 480)
                    .segments.reduce((n, s) => n + s.durationSeconds, 0)) - 0.3,
              ),
          ),
        );
        const samples = await Promise.all(pages.map(sample));
        const after = await snapshot("public");
        for (const s of samples) {
          if (
            s.rejectedSegments !== 0 ||
            s.verifiedSegments < 1 ||
            s.height !== 480
          )
            throw Error("Playback or integrity did not complete as specified");
        }
        const peerBytes = samples.reduce((n, s) => n + s.peerBytes, 0);
        if (assisted ? peerBytes <= 0 : peerBytes !== 0)
          throw Error("Peer condition did not match consent");
        const record = {
          repeat,
          mode: assisted ? "peer-assisted" : "http-only",
          viewers: 8,
          quality: 480,
          elapsedMS: Date.now() - started,
          consentSetupBodyBytes: setupBodyBytes,
          originMediaBodyBytes: mediaBytes(after) - mediaBytes(before),
          verifiedPeerPayloadBytes: peerBytes,
          uploadedPeerPayloadBytes: samples.reduce(
            (n, s) => n + s.uploadedBytes,
            0,
          ),
          samples,
        };
        report.rounds.push(record);
        await writeFile(
          join(root, `round-${repeat}-${record.mode}-counters.json`),
          JSON.stringify({ setupBefore, before, after }, null, 2) + "\n",
          { mode: 0o600 },
        );
        await save();
        console.log(
          JSON.stringify({
            repeat,
            mode: record.mode,
            originMediaBodyBytes: record.originMediaBodyBytes,
            consentSetupBodyBytes: setupBodyBytes,
            verifiedPeerPayloadBytes: peerBytes,
          }),
        );
        if (repeat === 1 && assisted)
          await pages[1].screenshot({
            path: join(root, "peer-watch.png"),
            fullPage: true,
          });
        if (
          report.rounds.reduce(
            (n, r) => n + r.originMediaBodyBytes + r.consentSetupBodyBytes,
            0,
          ) > 1073741824
        )
          throw Error("Peer campaign body-byte budget reached");
      } finally {
        await Promise.all(contexts.map((c) => c.close().catch(() => {})));
      }
    }
  report.comparisons = Array.from({ length: 3 }, (_, i) => {
    const baseline = report.rounds[i * 2],
      peer = report.rounds[i * 2 + 1];
    return {
      repeat: i + 1,
      httpBodyBytes: baseline.originMediaBodyBytes,
      peerBodyBytes: peer.originMediaBodyBytes,
      consentSetupBodyBytes: peer.consentSetupBodyBytes,
      originBodyReductionFraction:
        1 - peer.originMediaBodyBytes / baseline.originMediaBodyBytes,
      includingConsentReductionFraction:
        1 -
        (peer.originMediaBodyBytes + peer.consentSetupBodyBytes) /
          baseline.originMediaBodyBytes,
    };
  });
  await save();
} catch (e) {
  await save();
  await privateError("peers-error.txt", e);
} finally {
  await browser?.close();
}
