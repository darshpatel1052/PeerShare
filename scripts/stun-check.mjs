import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// An intentional network check against the running app. Routine tests keep
// STUN off. Only candidate types/counts are retained, never SDP or addresses.
const base = process.env.PEERSCREEN_CHECK_ORIGIN || "http://localhost:3000";
const origin = new URL(base);
if (
  origin.origin !== base ||
  !["localhost", "127.0.0.1", "peerscreen.darshpatel.dev"].includes(
    origin.hostname,
  )
)
  throw Error("Use the authorized local or public PeerShare origin");
const response = await fetch(`${base}/api/v1/videos?limit=1`);
if (!response.ok) throw new Error("The running catalogue is unavailable");
const video = (await response.json()).items[0];
if (!video) throw new Error("Publish a video before checking discovery");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    ignoreHTTPSErrors:
      origin.hostname === "localhost" || origin.hostname === "127.0.0.1",
  });
  await page.addInitScript(() => {
    const Original = window.RTCPeerConnection;
    window.__peerDiscovery = {
      connections: 0,
      configured: false,
      types: [],
      completed: 0,
    };
    window.RTCPeerConnection = class extends Original {
      constructor(config) {
        super(config);
        window.__peerDiscovery.connections++;
        window.__peerDiscovery.configured ||= (config?.iceServers ?? []).some(
          (server) => server.urls === "stun:stun.cloudflare.com:3478",
        );
        this.addEventListener("icecandidate", (event) => {
          if (
            event.candidate &&
            !window.__peerDiscovery.types.includes(event.candidate.type)
          )
            window.__peerDiscovery.types.push(event.candidate.type);
        });
        this.addEventListener("icegatheringstatechange", () => {
          if (this.iceGatheringState === "complete")
            window.__peerDiscovery.completed++;
        });
      }
    };
  });
  await page.goto(`${base}/watch/?v=${video.id}`);
  await page
    .getByTestId("player-status")
    .filter({ hasText: "Ready to play" })
    .waitFor();
  const before = await page.evaluate(() => window.__peerDiscovery.connections);
  await page.getByRole("checkbox", { name: "Help share this video" }).check();
  await page.locator("video").evaluate((element) => {
    element.muted = true;
    void element.play();
  });
  let timedOut = false;
  await page
    .waitForFunction(
      () =>
        window.__peerDiscovery.connections > 0 &&
        (window.__peerDiscovery.types.includes("srflx") ||
          window.__peerDiscovery.completed > 0),
      null,
      { timeout: 15000 },
    )
    .catch(() => {
      timedOut = true;
    });
  const observed = await page.evaluate(() => window.__peerDiscovery);
  const record = {
    checkedAt: new Date().toISOString(),
    scope: "real running player, one host, public STUN; address discovery only",
    origin: base,
    tlsErrorsIgnored:
      origin.hostname === "localhost" || origin.hostname === "127.0.0.1",
    browser: browser.version(),
    noConnectionsBeforeOptIn: before === 0,
    stunConfigured: observed.configured,
    candidateTypes: observed.types,
    gatheringCompleted: observed.completed,
    timedOut,
    publicAddressDiscovered: observed.types.includes("srflx"),
    crossNetworkMediaVerified: false,
  };
  await mkdir(".local/evidence", { recursive: true });
  await writeFile(
    ".local/evidence/stun-discovery.json",
    JSON.stringify(record, null, 2) + "\n",
  );
  console.log(JSON.stringify(record));
  if (before !== 0 || !observed.configured)
    throw new Error("Sharing consent or STUN configuration failed");
} finally {
  await browser.close();
}
