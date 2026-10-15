import { expect, test } from "@playwright/test";

test("PeerShare controls play, pause, seek, mute, adjust volume and enter fullscreen", async ({
  page,
}, info) => {
  await page.goto("/watch/?v=signal-garden");
  await expect(page.getByTestId("player-status")).toHaveText("Ready to play");
  expect(
    await page
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.controls),
  ).toBe(false);
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(0.3);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(
    await page
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.paused),
  ).toBe(true);
  const frame = page.getByRole("region", { name: "Video player", exact: true });
  await frame.focus();
  await frame.press("ArrowRight");
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(4);
  await frame.press("m");
  await expect(
    page.getByRole("button", { name: "Unmute", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.muted),
  ).toBe(true);
  await page.getByRole("button", { name: "Unmute", exact: true }).click();
  await page.getByRole("slider", { name: "Volume", exact: true }).focus();
  await page
    .getByRole("slider", { name: "Volume", exact: true })
    .press("ArrowLeft");
  expect(
    await page
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.volume),
  ).toBeLessThan(1);
  await page
    .getByRole("button", { name: "Enter fullscreen", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await page
    .getByRole("button", { name: "Exit fullscreen", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("slider", { name: "Seek video", exact: true }).focus();
  await page
    .getByRole("slider", { name: "Seek video", exact: true })
    .press("Home");
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeLessThan(0.5);
  await info.attach("custom-controls", {
    contentType: "application/json",
    body: JSON.stringify({
      nativeControls: false,
      playPause: true,
      keyboardSeek: true,
      mute: true,
      volume: true,
      fullscreen: true,
      mobileSeek: true,
      overflow: false,
      browser: info.project.use.browserName,
    }),
  });
});
