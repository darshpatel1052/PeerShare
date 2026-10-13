import { expect, test } from "@playwright/test";

test("production export supports direct watch/channel links and reload", async ({
  page,
}) => {
  await page.goto("/channel/?id=peerscreen-lab");
  await expect(
    page.getByRole("heading", { name: "PeerScreen Lab", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "PeerScreen Lab", exact: true }),
  ).toBeVisible();
  await page.goto("/watch/?v=signal-garden");
  await expect(page.getByTestId("player-status")).toHaveText("Ready to play");
  await page.reload();
  await expect(page.getByTestId("player-status")).toHaveText("Ready to play");
});

test("HTTP playback, seek and quality selection work with no tracker requests", async ({
  page,
}) => {
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto("/watch/?v=signal-garden");
  await expect(page.getByTestId("player-status")).toHaveText("Ready to play");
  await page.locator("video").evaluate((element: HTMLVideoElement) => {
    element.muted = true;
    void element.play();
  });
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(1);
  await expect
    .poll(async () => Number(await page.getByTestId("http-bytes").innerText()))
    .toBeGreaterThan(0);
  await expect(page.getByTestId("peer-bytes")).toHaveText("0");
  expect(sockets).toEqual([]);
  await page.getByLabel("Video quality").selectOption("480");
  await page.locator("video").evaluate((element: HTMLVideoElement) => {
    element.currentTime = 35;
  });
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(36);
  await expect(page.getByTestId("playback-error")).toHaveCount(0);
});

test("media origin supplies correct MIME and explicit cross-origin permission", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const response = await fetch("http://localhost:3101/fixture/master.m3u8");
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      text: await response.text(),
    };
  });
  expect(result.status).toBe(200);
  expect(result.type).toContain("application/vnd.apple.mpegurl");
  expect(result.text).toContain("#EXTM3U");
  const denied = await request.get(
    "http://localhost:3101/fixture/integrity.json",
    { headers: { Origin: "https://untrusted.example" } },
  );
  expect(denied.headers()["access-control-allow-origin"]).toBeUndefined();
  const segment = await request.get(
    "http://localhost:3101/fixture/360p/segment-000.ts",
  );
  expect(segment.headers()["content-type"]).toBe("video/mp2t");
});

test("missing videos and integrity failures show useful states", async ({
  page,
}) => {
  await page.goto("/watch/?v=missing");
  await expect(
    page.getByRole("heading", { name: "Video not found" }),
  ).toBeVisible();
  await page.route("**/integrity.json", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto("/watch/?v=signal-garden");
  await expect(page.getByTestId("playback-error")).toContainText(
    "integrity information is unavailable",
  );
  await page.unroute("**/integrity.json");
  await page.getByRole("button", { name: "Retry playback" }).click();
  await expect(page.getByTestId("player-status")).toHaveText("Ready to play");
});
