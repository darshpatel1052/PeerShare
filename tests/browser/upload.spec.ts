import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test("upload adaptive media, preview privately, publish, switch quality and revoke access", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), "peerscreen-upload-"));
  const mp4 = join(directory, "small.mp4");
  const artwork = join(directory, "artwork.jpg");
  const imageMade = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x415333:s=1280x720",
      "-frames:v",
      "1",
      "-threads",
      "1",
      artwork,
    ],
    { timeout: 10_000 },
  );
  expect(imageMade.status).toBe(0);
  const generated = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=24:duration=6",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=6",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-movflags",
      "+faststart",
      mp4,
    ],
    { timeout: 30_000 },
  );
  if (generated.error || generated.status !== 0)
    throw (
      generated.error ??
      new Error("Could not generate the local MP4 test source.")
    );
  try {
    const email = `${randomUUID()}@example.test`;
    await page.goto("/account/");
    await page
      .getByRole("button", { name: "Create an account", exact: true })
      .click();
    await page
      .getByLabel("Display name", { exact: true })
      .fill("Upload learner");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("a browser test passphrase 456");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await page
      .getByLabel("Channel handle", { exact: true })
      .fill(`uploader-${randomUUID().slice(0, 8)}`);
    await page
      .getByLabel("Channel title", { exact: true })
      .fill("Upload channel");
    await page
      .getByLabel("Description", { exact: true })
      .fill("End-to-end upload test");
    await page
      .getByRole("button", { name: "Create channel", exact: true })
      .click();
    await page
      .getByLabel("Channel banner", { exact: true })
      .setInputFiles(artwork);
    await page
      .getByRole("button", { name: "Save banner", exact: true })
      .click();
    await expect(
      page.getByText("Banner saved.", { exact: true }),
    ).toBeVisible();
    const meWithBanner = await (await page.request.get("/api/v1/me")).json();
    expect(meWithBanner.channel.banner_url).toContain("/api/v1/images/");
    await page.goto(`/channel/?id=${meWithBanner.channel.id}`);
    await expect(page.locator(".channel-cover img")).toHaveAttribute(
      "src",
      meWithBanner.channel.banner_url,
    );
    await page.goto("/studio/");
    await page.getByLabel("Video title").fill("My first published video");
    await page
      .getByLabel("Description", { exact: true })
      .fill("Processed from a local MP4.");
    await page.getByLabel("MP4 file").setInputFiles({
      name: "small.mp4",
      mimeType: "video/mp4",
      buffer: await readFile(mp4),
    });
    await page.getByRole("button", { name: "Start upload" }).click();
    await expect(page.getByText("Ready to publish")).toBeVisible({
      timeout: 90_000,
    });
    await page.getByRole("button", { name: /^Drafts/ }).click();
    await page
      .getByRole("button", { name: "Edit details", exact: true })
      .click();
    await page
      .getByLabel("Video thumbnail", { exact: true })
      .setInputFiles(artwork);
    await page
      .getByRole("button", { name: "Save thumbnail", exact: true })
      .click();
    await expect(
      page.getByText("Thumbnail saved.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Preview video", exact: true })
      .click();
    await expect(
      page.getByText("Preview ready", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Private video preview")
      .evaluate((video: HTMLVideoElement) => video.play());
    await expect
      .poll(() =>
        page
          .getByLabel("Private video preview")
          .evaluate((video: HTMLVideoElement) => video.currentTime),
      )
      .toBeGreaterThan(1);
    const owned = await (await page.request.get("/api/v1/uploads")).json();
    const videoID = owned.items[0].video_id;
    const thumbnailURL = owned.items[0].thumbnail_url;
    expect(owned.items[0].has_custom_thumbnail).toBe(true);
    const anonymous = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
    });
    try {
      expect(
        (await anonymous.request.get(`/api/v1/videos/${videoID}`)).status(),
      ).toBe(404);
      expect((await anonymous.request.get(thumbnailURL)).status()).toBe(404);
      await page.setViewportSize({ width: 1365, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const desktop = testInfo.outputPath("studio-desktop.png");
      await page.screenshot({ path: desktop, fullPage: true });
      await testInfo.attach("Creator studio · processed private preview", {
        path: desktop,
        contentType: "image/png",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
      await page.evaluate(() => window.scrollTo(0, 0));
      const mobile = testInfo.outputPath("studio-mobile.png");
      await page.screenshot({ path: mobile, fullPage: true });
      await testInfo.attach("Creator studio · mobile", {
        path: mobile,
        contentType: "image/png",
      });
      await page.setViewportSize({ width: 1365, height: 900 });
      await page
        .getByRole("button", { name: "Publish video", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "No drafts", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: /^Published/ }).click();
      await expect(page.getByText("Live on your channel")).toBeVisible();
      expect((await anonymous.request.get(thumbnailURL)).status()).toBe(200);
      const publicPage = await anonymous.newPage();
      await publicPage.goto(`/watch/?v=${videoID}`);
      await expect(publicPage.getByTestId("player-status")).toHaveText(
        "Ready to play",
        { timeout: 30_000 },
      );
      await expect(publicPage.locator("video")).toHaveAttribute(
        "poster",
        thumbnailURL,
      );
      const metadata = await (
        await anonymous.request.get(`/api/v1/videos/${videoID}`)
      ).json();
      expect(metadata.qualities).toEqual([480, 720]);
      await publicPage
        .getByLabel("Video quality", { exact: true })
        .selectOption("720");
      await publicPage
        .getByLabel("My first published video video player")
        .evaluate((video: HTMLVideoElement) => video.play());
      await expect
        .poll(() =>
          publicPage
            .locator("video")
            .evaluate((video: HTMLVideoElement) => video.currentTime),
        )
        .toBeGreaterThan(1);
      await expect
        .poll(() =>
          publicPage
            .locator("video")
            .evaluate((video: HTMLVideoElement) => video.videoHeight),
        )
        .toBe(720);
      await publicPage
        .getByLabel("Video quality", { exact: true })
        .selectOption("480");
      await publicPage
        .getByRole("slider", { name: "Seek video", exact: true })
        .focus();
      await publicPage
        .getByRole("slider", { name: "Seek video", exact: true })
        .press("Home");
      await expect
        .poll(() =>
          publicPage
            .locator("video")
            .evaluate((video: HTMLVideoElement) => video.videoHeight),
        )
        .toBe(480);
      const adaptiveScreenshot = testInfo.outputPath("adaptive-watch.png");
      await publicPage.screenshot({ path: adaptiveScreenshot, fullPage: true });
      await testInfo.attach(
        "Published adaptive playback · actual 480p/720p switching",
        { path: adaptiveScreenshot, contentType: "image/png" },
      );
      await publicPage.getByText("Connection details", { exact: true }).click();
      await expect
        .poll(async () =>
          Number(await publicPage.getByTestId("http-bytes").textContent()),
        )
        .toBeGreaterThan(0);
      await expect(publicPage.getByTestId("peer-bytes")).toHaveText("0");
      await page
        .getByRole("button", { name: "Unpublish", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "No published videos", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: /^Drafts/ }).click();
      await expect(
        page.getByRole("heading", { name: "No drafts", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: /^Unpublished/ }).click();
      await expect(
        page.getByText("Hidden from your channel", { exact: true }),
      ).toBeVisible();
      expect((await anonymous.request.get(thumbnailURL)).status()).toBe(404);
      expect(
        (await anonymous.request.get(`/api/v1/videos/${videoID}`)).status(),
      ).toBe(404);
      const detail = await (
        await page.request.get(`/api/v1/videos/${videoID}/preview`)
      ).json();
      expect(
        (await anonymous.request.get(detail.playback.manifest_url)).status(),
      ).toBe(404);
      const mediaPath = new URL(detail.playback.manifest_url).pathname.replace(
        "/media/",
        "/",
      );
      expect(
        (
          await anonymous.request.get(`http://localhost:3101${mediaPath}`)
        ).status(),
      ).toBe(404);
      expect(
        (
          await anonymous.request.get(
            detail.playback.manifest_url.replace("/videos/", "/%76ideos/"),
          )
        ).status(),
      ).toBe(404);
      await publicPage.reload();
      await expect(
        publicPage.getByRole("heading", { name: "Video not found" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Publish video", exact: true })
        .click();
      await page.getByRole("button", { name: /^Published/ }).click();
      await page.getByRole("link", { name: "Watch video" }).click();
      await expect(page.getByTestId("player-status")).toHaveText(
        "Ready to play",
        { timeout: 30_000 },
      );
      const publicList = await page.request.get("/api/v1/videos");
      expect(publicList.status()).toBe(200);
      expect(JSON.stringify(await publicList.json())).toContain(
        "My first published video",
      );
    } finally {
      await anonymous.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function creator(page: import("@playwright/test").Page) {
  const origin = "http://localhost:3100";
  const registered = await page.request.post("/api/v1/auth/register", {
    headers: { Origin: origin },
    data: {
      email: `${randomUUID()}@example.test`,
      password: "browser upload recovery password 123",
      display_name: "Studio creator",
    },
  });
  expect(registered.status()).toBe(201);
  const created = await page.request.post("/api/v1/channels", {
    headers: { Origin: origin },
    data: {
      handle: `studio-${randomUUID().slice(0, 8)}`,
      title: "Studio recovery",
      description: "Recovery testing",
    },
  });
  expect(created.status()).toBe(201);
  await page.goto("/studio/");
  await expect(
    page.getByRole("heading", { name: "Your videos." }),
  ).toBeVisible();
}

test("resume a multi-chunk MP4 after a lost connection and reload; reject a different same-size file", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), "peerscreen-multipart-"));
  const mp4 = join(directory, "resume.mp4");
  try {
    const made = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x8bcf87:size=320x240:rate=24:duration=10",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-b:v",
        "10M",
        "-minrate",
        "10M",
        "-maxrate",
        "10M",
        "-bufsize",
        "20M",
        "-x264-params",
        "nal-hrd=cbr:filler=1",
        "-movflags",
        "+faststart",
        mp4,
      ],
      { timeout: 30_000 },
    );
    expect(made.status).toBe(0);
    const bytes = await readFile(mp4);
    expect(bytes.length).toBeGreaterThan(8 * 1024 * 1024);
    expect(bytes.length).toBeLessThan(16 * 1024 * 1024);
    await creator(page);
    await page
      .getByLabel("Video title", { exact: true })
      .fill("An interrupted upload");
    await page.getByLabel("MP4 file").setInputFiles({
      name: "resume.mp4",
      mimeType: "video/mp4",
      buffer: bytes,
    });
    const interrupted = "**/uploads/*/parts/2";
    await page.route(interrupted, (route) => route.abort("connectionfailed"));
    await page.getByRole("button", { name: "Start upload" }).click();
    await expect(
      page.getByText(/^Upload [1-9][0-9]?% complete$/),
    ).toBeVisible();
    const before = await (await page.request.get("/api/v1/uploads")).json();
    expect(
      before.items[0].parts.map((p: { number: number }) => p.number),
    ).toEqual([1]);
    await page.unroute(interrupted);
    await page.reload();
    await page.getByLabel("MP4 file").setInputFiles({
      name: "wrong.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.alloc(bytes.length),
    });
    await page
      .getByRole("button", { name: "Resume with selected file" })
      .click();
    await expect(page.locator(".studio-page [role=alert]")).toContainText(
      "does not match the original",
    );
    const partRequests: number[] = [];
    page.on("request", (request) => {
      const match = /\/parts\/(\d+)$/.exec(request.url());
      if (request.method() === "PUT" && match)
        partRequests.push(Number(match[1]));
    });
    await page.getByLabel("MP4 file").setInputFiles({
      name: "resume.mp4",
      mimeType: "video/mp4",
      buffer: bytes,
    });
    await page
      .getByRole("button", { name: "Resume with selected file" })
      .click();
    await expect(page.getByText("Ready to publish")).toBeVisible({
      timeout: 60_000,
    });
    expect(partRequests).toEqual([2]);
    const after = await (await page.request.get("/api/v1/uploads")).json();
    expect(after.items[0].id).toBe(before.items[0].id);
    expect(after.items[0].video_id).toBe(before.items[0].video_id);
    await testInfo.attach("Multipart resume observations", {
      body: JSON.stringify(
        {
          bytes: bytes.length,
          uploadID: after.items[0].id,
          storedBefore: [1],
          transferredOnResume: partRequests,
          processing: after.items[0].processing_state,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed source stays private and studio metadata edits and deletion work", async ({
  page,
}) => {
  await creator(page);
  await page
    .getByLabel("Video title", { exact: true })
    .fill("An invalid source");
  await page.getByLabel("MP4 file").setInputFiles({
    name: "pretend.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("this is not an MP4 container"),
  });
  await page.getByRole("button", { name: "Start upload" }).click();
  await expect(
    page.getByText("This source is not a supported MP4 video.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish video", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await page.getByLabel("Edit video title").fill("A corrected title");
  await page.getByRole("button", { name: "Save video details" }).click();
  await expect(
    page.getByRole("heading", { name: "A corrected title" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Delete (draft|video)/, exact: true })
    .click();
  await page.getByRole("button", { name: "Keep video", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A corrected title" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Delete (draft|video)/, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "No drafts",
      exact: true,
    }),
  ).toBeVisible();
});
