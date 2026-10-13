import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";

function sourceRecord() {
  const paths = [
    "packages/player/src/index.ts",
    "packages/player/src/http-loader.ts",
    "packages/player/src/integrity.ts",
    "apps/web/components/watch.tsx",
    "tests/browser/peer.spec.ts",
    "package-lock.json",
  ];
  return {
    baseCommit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
    workingTreeChanged:
      execFileSync("git", ["status", "--porcelain"]).toString().trim().length >
      0,
    sourceHashes: Object.fromEntries(
      paths.map((path) => [
        path,
        createHash("sha256").update(readFileSync(path)).digest("hex"),
      ]),
    ),
    host: {
      platform: process.platform,
      cpu: cpus()[0].model,
      logicalCPUs: cpus().length,
      ramBytes: totalmem(),
    },
  };
}

const value = async (page: Page, id: string) =>
  Number(await page.getByTestId(id).innerText());

async function start(page: Page) {
  await page.goto("/watch/?v=signal-garden");
  await expect(page.getByTestId("player-status")).toHaveText("Ready to play");
  await page.getByText("Connection details", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Help share this video" }).check();
  await expect(page.getByTestId("player-status")).toHaveText("Ready to play");
  await page.getByLabel("Video quality").selectOption("360");
  await page.locator("video").evaluate((video: HTMLVideoElement) => {
    video.muted = true;
    void video.play();
  });
  await expect
    .poll(
      async () =>
        (await value(page, "http-bytes")) + (await value(page, "peer-bytes")),
    )
    .toBeGreaterThan(0);
}

async function measurements(page: Page) {
  return {
    httpBytes: await value(page, "http-bytes"),
    peerBytes: await value(page, "peer-bytes"),
    uploadedBytes: await value(page, "uploaded-bytes"),
    verifiedSegments: await value(page, "verified-segments"),
    rejectedSegments: await value(page, "rejected-segments"),
    peers: await value(page, "peer-count"),
  };
}

test("three independent viewers transfer verified peer bytes and recover after peers leave", async ({
  browser,
}, info) => {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  try {
    const [seed, first, second] = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    const trackerConnections: WebSocketRoute[] = [];
    let trackerLost = false;
    await first.routeWebSocket("ws://localhost:8100/", (socket) => {
      if (trackerLost) {
        socket.close({ code: 1001 });
        return;
      }
      trackerConnections.push(socket, socket.connectToServer());
    });
    await start(seed);
    await seed
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.pause());
    await start(first);
    await expect
      .poll(() => value(first, "peer-bytes"), { timeout: 25_000 })
      .toBeGreaterThan(0);
    await start(second);
    await expect
      .poll(() => value(second, "peer-bytes"), { timeout: 25_000 })
      .toBeGreaterThan(0);
    await expect.poll(() => value(seed, "uploaded-bytes")).toBeGreaterThan(0);
    const before = await Promise.all([
      measurements(seed),
      measurements(first),
      measurements(second),
    ]);
    expect(trackerConnections.length).toBeGreaterThan(0);
    trackerLost = true;
    for (const socket of trackerConnections)
      socket.close({ code: 1001, reason: "controlled tracker disconnection" });
    await contexts[0].close();
    await contexts[2].close();
    await expect.poll(() => value(first, "peer-count")).toBe(0);
    const httpBefore = await value(first, "http-bytes");
    await first.getByLabel("Video quality").selectOption("480");
    await first.locator("video").evaluate((video: HTMLVideoElement) => {
      video.currentTime = 45;
      void video.play();
    });
    await expect
      .poll(() => value(first, "http-bytes"))
      .toBeGreaterThan(httpBefore);
    await expect
      .poll(() =>
        first
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.currentTime),
      )
      .toBeGreaterThan(46);
    await expect(first.getByTestId("playback-error")).toHaveCount(0);
    await info.attach("peer-delivery-evidence", {
      contentType: "application/json",
      body: JSON.stringify(
        {
          source: sourceRecord(),
          testedAt: new Date().toISOString(),
          browser: browser.version(),
          scope:
            "3 isolated Chromium contexts on one Linux host, loopback network, no external STUN",
          fixture:
            "60s lavfi H.264/AAC, 360p peers then 480p seek, 4s segments",
          beforePeerDeparture: before,
          afterPeerDeparture: await measurements(first),
          trackerDisconnected: trackerLost,
        },
        null,
        2,
      ),
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("corrupted bytes sent on a real data channel are rejected, then HTTP playback succeeds", async ({
  browser,
}, info) => {
  const seedContext = await browser.newContext();
  const receiverContext = await browser.newContext();
  try {
    const seed = await seedContext.newPage();
    await seed.addInitScript(() => {
      const original = RTCDataChannel.prototype.send;
      const state = window as typeof window & { __tamperedChunks: number };
      state.__tamperedChunks = 0;
      RTCDataChannel.prototype.send = function (
        data: string | Blob | ArrayBuffer | ArrayBufferView,
      ) {
        let bytes: Uint8Array | undefined;
        if (data instanceof ArrayBuffer) bytes = new Uint8Array(data.slice(0));
        else if (ArrayBuffer.isView(data))
          bytes = new Uint8Array(
            data.buffer.slice(
              data.byteOffset,
              data.byteOffset + data.byteLength,
            ),
          );
        // Commands are small. Mutate media payload only, leaving the protocol intact.
        if (bytes && bytes.byteLength > 2048) {
          bytes[100] ^= 1;
          state.__tamperedChunks += 1;
          Reflect.apply(original, this, [bytes]);
        } else Reflect.apply(original, this, [data]);
      };
    });
    await start(seed);
    await seed
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.pause());
    const receiver = await receiverContext.newPage();
    await start(receiver);
    await expect
      .poll(() => value(receiver, "rejected-segments"), { timeout: 25_000 })
      .toBeGreaterThan(0);
    await expect.poll(() => value(receiver, "http-bytes")).toBeGreaterThan(0);
    await expect
      .poll(() =>
        receiver
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.currentTime),
      )
      .toBeGreaterThan(2);
    expect(
      await seed.evaluate(
        () =>
          (window as typeof window & { __tamperedChunks: number })
            .__tamperedChunks,
      ),
    ).toBeGreaterThan(0);
    await expect(receiver.getByTestId("playback-error")).toHaveCount(0);
    await expect(receiver.getByTestId("peer-bytes")).toHaveText("0");
    await info.attach("tamper-evidence", {
      contentType: "application/json",
      body: JSON.stringify(
        {
          browser: browser.version(),
          source: sourceRecord(),
          testedAt: new Date().toISOString(),
          tamperedMediaChunks: await seed.evaluate(
            () =>
              (window as typeof window & { __tamperedChunks: number })
                .__tamperedChunks,
          ),
          receiver: await measurements(receiver),
          injection:
            "test-only mutation of outgoing RTCDataChannel media bytes; trusted descriptor and HTTP bytes unchanged",
        },
        null,
        2,
      ),
    });
  } finally {
    await seedContext.close();
    await receiverContext.close();
  }
});

test("sharing off and route departure close real WebRTC connections", async ({
  browser,
}) => {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  try {
    const [seed, viewer] = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    await viewer.addInitScript(() => {
      const Original = window.RTCPeerConnection;
      const state = window as typeof window & {
        __connections: RTCPeerConnection[];
      };
      state.__connections = [];
      window.RTCPeerConnection = class extends Original {
        constructor(config?: RTCConfiguration) {
          super(config);
          state.__connections.push(this);
        }
      };
    });
    await start(seed);
    await start(viewer);
    await expect.poll(() => value(viewer, "peer-count")).toBeGreaterThan(0);
    await viewer
      .getByRole("checkbox", { name: "Help share this video" })
      .uncheck();
    await expect(viewer.getByTestId("player-status")).toHaveText(
      "Ready to play",
    );
    await expect
      .poll(() =>
        viewer.evaluate(() =>
          (
            window as typeof window & { __connections: RTCPeerConnection[] }
          ).__connections.every(
            (connection) => connection.connectionState === "closed",
          ),
        ),
      )
      .toBe(true);
    await expect(viewer.getByTestId("peer-count")).toHaveText("0");
    await viewer
      .getByRole("checkbox", { name: "Help share this video" })
      .check();
    await expect.poll(() => value(viewer, "peer-count")).toBeGreaterThan(0);
    await viewer
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Explore", exact: true })
      .click();
    await expect(
      viewer.getByRole("heading", { name: "Explore.", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        viewer.evaluate(() =>
          (
            window as typeof window & { __connections: RTCPeerConnection[] }
          ).__connections.every(
            (connection) => connection.connectionState === "closed",
          ),
        ),
      )
      .toBe(true);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("an unavailable tracker leaves verified HTTP playback working", async ({
  page,
}) => {
  let blockedConnections = 0;
  await page.routeWebSocket("ws://localhost:8100/", (socket) => {
    blockedConnections += 1;
    socket.close({ code: 1001, reason: "controlled tracker loss" });
  });
  await start(page);
  await expect.poll(() => value(page, "http-bytes")).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(2);
  await expect(page.getByTestId("peer-bytes")).toHaveText("0");
  await expect(page.getByTestId("playback-error")).toHaveCount(0);
  expect(blockedConnections).toBeGreaterThan(0);
});

test("different trusted media versions stay in separate peer swarms", async ({
  browser,
}) => {
  const seedContext = await browser.newContext();
  const otherContext = await browser.newContext();
  try {
    const seed = await seedContext.newPage();
    const other = await otherContext.newPage();
    await other.route("**/integrity.json", async (route) => {
      const response = await route.fetch();
      const descriptor = await response.json();
      descriptor.mediaVersion = createHash("sha256")
        .update(descriptor.mediaVersion + "another accepted version")
        .digest("hex");
      await route.fulfill({ response, json: descriptor });
    });
    await start(seed);
    await start(other);
    await expect
      .poll(() =>
        other
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.currentTime),
      )
      .toBeGreaterThan(5);
    await expect(other.getByTestId("peer-count")).toHaveText("0");
    await expect(other.getByTestId("peer-bytes")).toHaveText("0");
    await expect.poll(() => value(other, "http-bytes")).toBeGreaterThan(0);
  } finally {
    await seedContext.close();
    await otherContext.close();
  }
});
