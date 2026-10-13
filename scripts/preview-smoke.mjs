import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const mode = process.argv[2];
assert.ok(["development", "containers"].includes(mode));
await mkdir(".local/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const responses = [];
async function api(path, options) {
  const r = await context.request.fetch(
    "http://localhost:3000" + path,
    options,
  );
  const body = await r.json();
  responses.push({ path, status: r.status(), body });
  return r;
}
try {
  const live = await api("/health/ready");
  assert.equal(live.status(), 200);
  assert.equal((await api("/api/v1/me")).status(), 401);
  assert.equal(
    (
      await api("/api/v1/auth/login", {
        method: "POST",
        headers: { Origin: "http://localhost:3000" },
        data: {
          email: "absent-smoke@example.test",
          password: "unmatched smoke passphrase 123",
        },
      })
    ).status(),
    401,
  );
  assert.equal(
    (
      await api("/api/v1/auth/login", {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
        data: {
          email: "absent-smoke@example.test",
          password: "unmatched smoke passphrase 123",
        },
      })
    ).status(),
    403,
  );
  const catalogue = await api("/api/v1/videos?limit=1");
  assert.equal(catalogue.status(), 200);
  await page.goto("http://localhost:3000/");
  await page
    .getByRole("heading", { name: "Signal garden", exact: true })
    .waitFor();
  await page.screenshot({
    path: `.local/screenshots/phase1-${mode}-home.png`,
    fullPage: true,
  });
  await page.goto("http://localhost:3000/account/");
  await page
    .getByRole("heading", { name: "Welcome back.", exact: true })
    .waitFor();
  await page.screenshot({
    path: `.local/screenshots/phase1-${mode}-account.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `.local/screenshots/phase1-${mode}-mobile.png`,
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("http://localhost:3000/watch/?v=signal-garden");
  await page
    .getByTestId("player-status")
    .filter({ hasText: "Ready to play" })
    .waitFor();
  await page.getByText("Connection details", { exact: true }).click();
  await page.locator("video").evaluate((v) => {
    v.muted = true;
    void v.play();
  });
  await page.waitForFunction(
    () => document.querySelector("video")?.currentTime > 1,
  );
  assert.equal(await page.getByTestId("peer-bytes").innerText(), "0");
  const playback = {
    seconds: await page.locator("video").evaluate((v) => v.currentTime),
    httpBytes: Number(await page.getByTestId("http-bytes").innerText()),
    peerBytes: 0,
  };
  assert.ok(playback.httpBytes > 0);
  await page.screenshot({
    path: `.local/screenshots/phase1-${mode}-watch.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    `.local/evidence/phase-1-${mode}.json`,
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        mode,
        browser: browser.version(),
        responses,
        playback,
        pageErrors: errors,
        mobileHorizontalOverflow: false,
        scope:
          "Anonymous real browser and API proxy smoke, correct and rejected Origin, real verified HTTP playback. No credentials/cookies recorded.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `PASS ${mode}: real API proxy, Origin checks, mobile width, HTTP playback and no browser exceptions.`,
  );
} finally {
  await browser.close();
}
