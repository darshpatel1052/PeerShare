import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import {
  createCreator,
  generateSource,
  uploadVideo,
} from "./helpers/owned-media";

async function counters(page: Page) {
  return {
    http: Number(await page.getByTestId("http-bytes").innerText()),
    peer: Number(await page.getByTestId("peer-bytes").innerText()),
    uploaded: Number(await page.getByTestId("uploaded-bytes").innerText()),
    verified: Number(await page.getByTestId("verified-segments").innerText()),
    rejected: Number(await page.getByTestId("rejected-segments").innerText()),
    peers: Number(await page.getByTestId("peer-count").innerText()),
    playhead: await page
      .locator("video")
      .evaluate((element: HTMLVideoElement) => element.currentTime),
  };
}

test("three viewers exchange verified uploaded media with measured HTTP baseline and gateway bytes", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300000);
  const source = await generateSource(32);
  const channel = await createCreator(page, "Delivery studio");
  try {
    const video = await uploadVideo(
      page,
      channel.id,
      source.payload,
      "Uploaded delivery study",
    );
    const gateway = async () =>
      await (
        await page.request.get(`/__peerscreen-test/delivery?video=${video.id}`)
      ).json();
    const rounds = [];
    for (let repeat = 0; repeat < 1; repeat++) {
      for (const assisted of [false, true]) {
        const contexts = await Promise.all(
          Array.from({ length: 3 }, () => browser.newContext()),
        );
        const viewers = await Promise.all(
          contexts.map((context) => context.newPage()),
        );
        try {
          for (const viewer of viewers) {
            const cdp = await viewer.context().newCDPSession(viewer);
            await cdp.send("Network.enable");
            await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
          }
          let consentSetupBytes = 0;
          if (assisted) {
            const prior = await gateway();
            for (const viewer of viewers) {
              await viewer.goto(`/watch/?v=${video.id}`);
              await expect(viewer.getByTestId("player-status")).toHaveText(
                "Ready to play",
              );
              await viewer
                .getByRole("checkbox", { name: "Help share this video" })
                .check();
              await expect(viewer.getByTestId("player-status")).toHaveText(
                "Ready to play",
              );
              await viewer.goto("/");
            }
            consentSetupBytes =
              (await gateway()).responseBodyBytes - prior.responseBodyBytes;
          }
          const before = await gateway();
          const started = Date.now();
          async function start(viewer: Page) {
            await viewer.goto(`/watch/?v=${video.id}`);
            await expect(viewer.getByTestId("player-status")).toHaveText(
              "Ready to play",
            );
            await expect(
              viewer.getByRole("checkbox", { name: "Help share this video" }),
            ).toBeChecked({ checked: assisted });
            await viewer
              .getByText("Connection details", { exact: true })
              .click();
            await viewer.getByLabel("Video quality").selectOption("480");
            await viewer
              .locator("video")
              .evaluate((element: HTMLVideoElement) => {
                element.muted = true;
                void element.play();
              });
            await expect
              .poll(() =>
                viewer
                  .locator("video")
                  .evaluate((element: HTMLVideoElement) => element.currentTime),
              )
              .toBeGreaterThan(1);
          }
          await start(viewers[0]);
          await expect
            .poll(() =>
              viewers[0]
                .locator("video")
                .evaluate((element: HTMLVideoElement) => element.currentTime),
            )
            .toBeGreaterThan(4);
          await Promise.all(viewers.slice(1).map(start));
          const windowStarted = Date.now();
          if (assisted) {
            await expect
              .poll(
                async () =>
                  (await counters(viewers[1])).peer +
                  (await counters(viewers[2])).peer,
                { timeout: 8000 },
              )
              .toBeGreaterThan(0);
          }
          // Fixed observation interval is a measurement window, not UI synchronization.
          await viewers[0].waitForTimeout(
            Math.max(0, 8000 - (Date.now() - windowStarted)),
          );
          const samples = await Promise.all(viewers.map(counters));
          const after = await gateway();
          for (const sample of samples) {
            expect(sample.verified).toBeGreaterThan(0);
            expect(sample.rejected).toBe(0);
            expect(sample.playhead).toBeGreaterThan(1);
          }
          if (!assisted) {
            expect(samples.reduce((sum, value) => sum + value.peer, 0)).toBe(0);
            expect(
              samples.reduce((sum, value) => sum + value.uploaded, 0),
            ).toBe(0);
          } else {
            expect(
              samples.reduce((sum, value) => sum + value.peer, 0),
            ).toBeGreaterThan(0);
            expect(
              samples.reduce((sum, value) => sum + value.uploaded, 0),
            ).toBeGreaterThan(0);
          }
          rounds.push({
            repeat: repeat + 1,
            mode: assisted ? "peer-assisted" : "http-only",
            quality: 480,
            viewerCount: 3,
            consentSetupServerBodyBytes: consentSetupBytes,
            totalRunMS: Date.now() - started,
            observationWindowMS: Date.now() - windowStarted,
            gatewayResponseBodyBytes:
              after.responseBodyBytes - before.responseBodyBytes,
            gatewayCompletedSegmentBytes:
              after.completedSegmentBytes - before.completedSegmentBytes,
            gatewayCompletedResponses:
              after.completedResponses - before.completedResponses,
            gatewayAbortedResponses:
              after.abortedResponses - before.abortedResponses,
            samples,
          });
          if (assisted && repeat === 0) {
            const picture = info.outputPath("uploaded-peer-watch.png");
            await viewers[1].screenshot({ path: picture, fullPage: true });
            await info.attach("uploaded-peer-watch", {
              path: picture,
              contentType: "image/png",
            });
          }
          if (assisted) {
            await contexts[0].close();
            const receiver = viewers[1];
            await receiver
              .getByRole("checkbox", { name: "Help share this video" })
              .uncheck();
            await expect(receiver.getByTestId("player-status")).toHaveText(
              "Ready to play",
            );
            await receiver.getByLabel("Video quality").selectOption("720");
            await receiver
              .locator("video")
              .evaluate((element: HTMLVideoElement) => {
                element.currentTime = 20;
                void element.play();
              });
            await expect
              .poll(() =>
                receiver
                  .locator("video")
                  .evaluate((element: HTMLVideoElement) => element.videoHeight),
              )
              .toBe(720);
            await expect
              .poll(async () => (await counters(receiver)).http)
              .toBeGreaterThan(0);
            await expect(receiver.getByTestId("peer-bytes")).toHaveText("0");
          }
        } finally {
          await Promise.all(
            contexts.map((context) => context.close().catch(() => {})),
          );
        }
      }
    }
    const paths = [
      "packages/player/src/index.ts",
      "packages/player/src/integrity.ts",
      "apps/web/lib/playback-capture.ts",
      "apps/web/components/watch.tsx",
      "scripts/static-server.mjs",
      "scripts/api-proxy.mjs",
      "tests/browser/uploaded-peer.spec.ts",
    ];
    const hashes: Record<string, string> = {};
    for (const path of paths)
      hashes[path] = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
    const report = {
      checkedAt: new Date().toISOString(),
      baseCommit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
      workingTreeChanged: true,
      sourceHashes: hashes,
      scope:
        "one Linux host; independent Chromium contexts; loopback tracker; STUN disabled; actual owned uploaded 32s 720p source; 480p measured then 720p seek/HTTP fallback",
      browser: browser.version(),
      host: {
        cpu: cpus()[0].model,
        logicalCPUs: cpus().length,
        ramBytes: totalmem(),
      },
      sourceBytes: source.payload.length,
      cacheState:
        "Chromium HTTP cache disabled; fresh contexts per round; explicit per-video consent visit followed by route exit before measured peer run",
      metricDefinitions: {
        client: "completed verified media payload, not wire bytes",
        server:
          "test-only gateway-observed media response bodies, including bytes before abort; excludes manifests, descriptors and protocol overhead",
        consentSetup:
          "reported separately and excluded from measured-run bytes; does not represent total visitor cost",
      },
      rounds,
      comparisons: [0].map((index) => {
        const baseline = rounds[index * 2],
          peer = rounds[index * 2 + 1];
        return {
          repeat: index + 1,
          httpOnlyServerBytes: baseline.gatewayResponseBodyBytes,
          peerRunServerBytes: peer.gatewayResponseBodyBytes,
          measuredServerBodyDifference:
            baseline.gatewayResponseBodyBytes - peer.gatewayResponseBodyBytes,
          includingConsentSetupDifference:
            baseline.gatewayResponseBodyBytes -
            peer.gatewayResponseBodyBytes -
            peer.consentSetupServerBodyBytes,
        };
      }),
    };
    await mkdir(".local/evidence", { recursive: true });
    await writeFile(
      ".local/evidence/phase-4-uploaded-peer.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    await info.attach("uploaded-peer-measurement", {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: "application/json",
    });
  } finally {
    await source.close();
  }
});
