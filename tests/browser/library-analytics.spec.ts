import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  createCreator,
  generateSource,
  origin,
  register,
  uploadVideo,
} from "./helpers/owned-media";

test("a delayed thumbnail save keeps the newly selected video editor intact", async ({
  page,
}) => {
  test.setTimeout(120000);
  const source = await generateSource();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saved = false;
  try {
    const channel = await createCreator(page);
    const first = await uploadVideo(
      page,
      channel.id,
      source.payload,
      "Thumbnail A",
    );
    await uploadVideo(page, channel.id, source.payload, "Thumbnail B");
    await page.goto("/studio/");
    await page
      .getByRole("group", { name: "Video library filters" })
      .getByRole("button", { name: /^Published \d+$/ })
      .click();
    const firstCard = page.locator(".upload-card").filter({
      has: page.getByRole("heading", { name: "Thumbnail A", exact: true }),
    });
    const secondCard = page.locator(".upload-card").filter({
      has: page.getByRole("heading", { name: "Thumbnail B", exact: true }),
    });
    await firstCard.getByRole("button", { name: "Edit details" }).click();
    const image = execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=lime:s=1280x720",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "pipe:1",
    ]);
    await page.route(
      `**/api/v1/videos/${first.id}/thumbnail`,
      async (route) => {
        const response = await route.fetch();
        saved = true;
        await gate;
        await route.fulfill({ response });
      },
    );
    await firstCard
      .getByLabel("Video thumbnail", { exact: true })
      .setInputFiles({
        name: "cover.png",
        mimeType: "image/png",
        buffer: image,
      });
    await firstCard
      .getByRole("button", { name: "Save thumbnail", exact: true })
      .click();
    await expect.poll(() => saved).toBe(true);
    await secondCard.getByRole("button", { name: "Edit details" }).click();
    const prior = await secondCard
      .getByAltText("Current thumbnail", { exact: true })
      .getAttribute("src");
    await secondCard
      .getByLabel("Edit video title", { exact: true })
      .fill("Thumbnail B edited");
    release();
    await expect
      .poll(async () => {
        const rows = await (await page.request.get("/api/v1/uploads")).json();
        return rows.items.find(
          (row: { video_id: string }) => row.video_id === first.id,
        ).has_custom_thumbnail;
      })
      .toBe(true);
    // A's callback finishes its refresh before this catalogue image updates.
    await expect(firstCard.locator("img.library-thumbnail")).toHaveAttribute(
      "src",
      /\/api\/v1\/images\//,
    );
    await expect(
      secondCard.getByAltText("Current thumbnail", { exact: true }),
    ).toHaveAttribute("src", prior!);
    await secondCard
      .getByRole("button", { name: "Save video details", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Thumbnail B edited", exact: true }),
    ).toBeVisible();
  } finally {
    release();
    await source.close();
  }
});

test("viewer follows, searches unloaded videos, saves and reorders a private playlist, then shares it", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  const source = await generateSource();
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    const channel = await createCreator(page);
    const first = await uploadVideo(
      page,
      channel.id,
      source.payload,
      "Harbor walk",
    );
    const second = await uploadVideo(
      page,
      channel.id,
      source.payload,
      "After the rain",
    );
    await register(viewer);
    await viewer.goto(`/channel/?id=${channel.id}`);
    await viewer.getByRole("button", { name: "Follow", exact: true }).click();
    await expect(
      viewer.getByRole("button", { name: "Following", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await viewer.goto("/following/");
    await expect(
      viewer.getByRole("heading", { name: "Harbor walk", exact: true }),
    ).toBeVisible();
    for (const path of ["/following/", `/channel/?id=${channel.id}`]) {
      await viewer.goto(path);
      await viewer
        .getByLabel("Search videos", { exact: true })
        .fill("absent-result");
      await expect(
        viewer.getByRole("heading", { name: "No matching videos" }),
      ).toBeVisible();
      await expect(
        viewer.getByLabel("Search videos", { exact: true }),
      ).toBeVisible();
      await viewer
        .getByLabel("Search videos", { exact: true })
        .fill("Harbor walk");
      await expect(
        viewer.getByRole("heading", { name: "Harbor walk", exact: true }),
      ).toBeVisible();
      await viewer.getByRole("button", { name: "Clear video search" }).click();
      await expect(
        viewer.getByRole("heading", { name: "After the rain", exact: true }),
      ).toBeVisible();
    }
    // Real server pagination is restricted to one result to prove that search
    // can find a video that was never loaded; response contents are not mocked.
    await viewer.route("**/api/v1/videos?**", async (route) => {
      const url = new URL(route.request().url());
      url.searchParams.set("limit", "1");
      await route.continue({ url: url.href });
    });
    await viewer.goto("/");
    await expect(
      viewer.getByRole("heading", { name: "After the rain", exact: true }),
    ).toBeVisible();
    await expect(
      viewer.getByRole("heading", { name: "Harbor walk", exact: true }),
    ).toHaveCount(0);
    await viewer
      .getByLabel("Search videos", { exact: true })
      .fill("Harbor walk");
    await expect(
      viewer.getByRole("heading", { name: "Harbor walk", exact: true }),
    ).toBeVisible();
    await viewer.goto("/library/");
    await viewer
      .getByRole("button", { name: "New playlist", exact: true })
      .click();
    await viewer
      .getByLabel("Playlist name", { exact: true })
      .fill("Weekend films");
    await viewer
      .getByRole("button", { name: "Create playlist", exact: true })
      .click();
    await expect(
      viewer.getByRole("heading", { name: "Weekend films", exact: true }),
    ).toBeVisible();
    const playlists = await (
      await viewer.request.get("/api/v1/playlists")
    ).json();
    const playlist = playlists.items.find(
      (value: { title: string }) => value.title === "Weekend films",
    );
    expect(playlist.visibility).toBe("private");
    for (const video of [first, second]) {
      await viewer.goto(`/watch/?v=${video.id}`);
      await expect(viewer.getByTestId("player-status")).toHaveText(
        "Ready to play",
      );
      await viewer.getByRole("button", { name: "Save", exact: true }).click();
      await viewer
        .getByLabel("Choose playlist", { exact: true })
        .selectOption(playlist.id);
      await viewer
        .getByRole("button", { name: "Save video", exact: true })
        .click();
      await expect(
        viewer
          .getByRole("status")
          .filter({ hasText: "Saved to Weekend films" }),
      ).toBeVisible();
    }
    await viewer.goto(`/playlist/?id=${playlist.id}`);
    await viewer
      .getByRole("button", { name: "Move After the rain up", exact: true })
      .click();
    await expect(viewer.locator(".playlist-item").first()).toContainText(
      "After the rain",
    );
    await viewer.reload();
    await expect(viewer.locator(".playlist-item").first()).toContainText(
      "After the rain",
    );
    await guest.goto(`/playlist/?id=${playlist.id}`);
    await expect(
      guest.getByRole("heading", { name: "Playlist unavailable", exact: true }),
    ).toBeVisible();
    const desktop = info.outputPath("playlist-desktop.png");
    await viewer.screenshot({ path: desktop, fullPage: true });
    await info.attach("playlist-desktop", {
      path: desktop,
      contentType: "image/png",
    });
    await viewer
      .getByRole("button", { name: "Edit playlist", exact: true })
      .click();
    await viewer
      .getByLabel("Visibility", { exact: true })
      .selectOption("public");
    await viewer
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      viewer.getByText("Public playlist", { exact: true }),
    ).toBeVisible();
    await guest.reload();
    await expect(
      guest.getByRole("heading", { name: "Weekend films", exact: true }),
    ).toBeVisible();
    await guest
      .getByRole("link", { name: "Play playlist", exact: true })
      .click();
    await expect(guest.getByTestId("player-status")).toHaveText(
      "Ready to play",
    );
    await expect
      .poll(() => new URL(guest.url()).searchParams.get("v"))
      .toBe(second.id);
    await guest.locator("video").evaluate((element: HTMLVideoElement) => {
      element.muted = true;
      void element.play();
    });
    await expect
      .poll(() => new URL(guest.url()).searchParams.get("v"), {
        timeout: 20000,
      })
      .toBe(first.id);
    await expect(guest.getByTestId("player-status")).toHaveText(
      "Ready to play",
    );
    await guest.goto(`/playlist/?id=${playlist.id}`);
    expect(
      (
        await page.request.post(`/api/v1/videos/${second.id}/unpublish`, {
          headers: { Origin: origin },
        })
      ).status(),
    ).toBe(200);
    await guest.reload();
    await expect(
      guest.getByRole("heading", { name: "After the rain", exact: true }),
    ).toHaveCount(0);
    await expect(
      guest.getByRole("heading", { name: "Harbor walk", exact: true }),
    ).toBeVisible();
    await viewer.reload();
    await expect(
      viewer.getByRole("heading", { name: "Video unavailable", exact: true }),
    ).toBeVisible();
    await viewer
      .getByRole("button", {
        name: "Remove unavailable video from playlist",
        exact: true,
      })
      .click();
    await expect(viewer.locator(".playlist-item")).toHaveCount(1);
    await viewer.setViewportSize({ width: 390, height: 844 });
    const mobile = info.outputPath("playlist-mobile.png");
    await viewer.screenshot({ path: mobile, fullPage: true });
    await info.attach("playlist-mobile", {
      path: mobile,
      contentType: "image/png",
    });
    expect(
      await viewer.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await viewer.goto(`/channel/?id=${channel.id}`);
    await viewer
      .getByRole("button", { name: "Following", exact: true })
      .click();
    await viewer.goto("/following/");
    await expect(
      viewer.getByText("Follow channels to see their latest videos here.", {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await source.close();
    await viewerContext.close();
    await guestContext.close();
  }
});

test("a lost playlist creation response retries one logical request and stale edits preserve the form", async ({
  page,
}, info) => {
  await register(page);
  await page.goto("/library/");
  let lost = true;
  let requests = 0;
  await page.route("**/api/v1/playlists", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    requests++;
    if (lost) {
      lost = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "New playlist", exact: true }).click();
  await page
    .getByLabel("Playlist name", { exact: true })
    .fill("Keep for later");
  await page
    .getByRole("button", { name: "Create playlist", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "could not be reached",
  );
  await expect(page.getByLabel("Playlist name", { exact: true })).toHaveValue(
    "Keep for later",
  );
  await page
    .getByRole("button", { name: "Create playlist", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Keep for later", exact: true }),
  ).toBeVisible();
  expect(requests).toBe(2);
  const listed = await (await page.request.get("/api/v1/playlists")).json();
  expect(listed.items).toHaveLength(1);
  const playlist = listed.items[0];
  await page.goto(`/playlist/?id=${playlist.id}`);
  await page
    .getByRole("button", { name: "Edit playlist", exact: true })
    .click();
  await page
    .getByLabel("Playlist name", { exact: true })
    .fill("My unsaved rename");
  expect(
    (
      await page.request.patch(`/api/v1/playlists/${playlist.id}`, {
        headers: { Origin: origin },
        data: {
          title: "A newer change",
          visibility: "private",
          revision: playlist.revision,
        },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "changed since you opened",
  );
  await expect(page.getByLabel("Playlist name", { exact: true })).toHaveValue(
    "My unsaved rename",
  );
  await page
    .getByRole("button", { name: "Reload playlist", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A newer change", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Playlist name", { exact: true })).toHaveValue(
    "My unsaved rename",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "My unsaved rename", exact: true }),
  ).toBeVisible();
  await page.goto("/library/");
  const screenshot = info.outputPath("library-desktop.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await info.attach("library-desktop", {
    path: screenshot,
    contentType: "image/png",
  });
});

test("real playback qualifies once across sharing changes and owner analytics report actual payload", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150000);
  const source = await generateSource(12);
  const context = await browser.newContext();
  const viewer = await context.newPage();
  try {
    const channel = await createCreator(page, "Measured studio");
    const video = await uploadVideo(
      page,
      channel.id,
      source.payload,
      "Measured playback",
    );
    let starts = 0;
    viewer.on("request", (request) => {
      if (request.url().endsWith("/api/v1/playback/sessions")) starts++;
    });
    await viewer.goto(`/watch/?v=${video.id}`);
    await expect(viewer.getByTestId("player-status")).toHaveText(
      "Ready to play",
    );
    await viewer.locator("video").evaluate((element: HTMLVideoElement) => {
      element.muted = true;
      void element.play();
    });
    await expect
      .poll(
        () =>
          viewer
            .locator("video")
            .evaluate((element: HTMLVideoElement) => element.currentTime),
        { timeout: 15000 },
      )
      .toBeGreaterThan(2);
    await viewer
      .getByRole("checkbox", { name: "Help share this video" })
      .check();
    await expect(viewer.getByTestId("player-status")).toHaveText(
      "Ready to play",
    );
    await expect
      .poll(
        () =>
          viewer
            .locator("video")
            .evaluate((element: HTMLVideoElement) => element.currentTime),
        { timeout: 15000 },
      )
      .toBeGreaterThan(7);
    await viewer
      .getByRole("checkbox", { name: "Help share this video" })
      .uncheck();
    await expect(viewer.getByTestId("player-status")).toHaveText(
      "Ready to play",
    );
    await viewer
      .locator("video")
      .evaluate((element: HTMLVideoElement) => element.pause());
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `/api/v1/videos/${video.id}/analytics`,
          );
          return (await response.json()).totals.qualified_plays;
        },
        { timeout: 15000 },
      )
      .toBe(1);
    expect(starts).toBe(1);
    const metrics = await (
      await page.request.get(`/api/v1/videos/${video.id}/analytics`)
    ).json();
    expect(metrics.totals.sessions).toBe(1);
    expect(metrics.totals.http_bytes).toBeGreaterThan(0);
    expect(metrics.totals.native_sessions).toBe(0);
    expect(
      (
        await viewer.request.get(`/api/v1/videos/${video.id}/analytics`)
      ).status(),
    ).toBe(401);
    await page.goto(`/analytics/?v=${video.id}`);
    await expect(page.getByTestId("analytics-qualified-plays")).toHaveText("1");
    const desktop = info.outputPath("analytics-desktop.png");
    await page.screenshot({ path: desktop, fullPage: true });
    await info.attach("analytics-desktop", {
      path: desktop,
      contentType: "image/png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = info.outputPath("analytics-mobile.png");
    await page.screenshot({ path: mobile, fullPage: true });
    await info.attach("analytics-mobile", {
      path: mobile,
      contentType: "image/png",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await info.attach("real-playback-analytics", {
      body: Buffer.from(
        JSON.stringify(
          {
            scope:
              "actual generated uploaded 12s source; real Chromium frame progress and sharing changes; one logical watch session",
            sourceBytes: source.payload.length,
            videoID: video.id,
            totals: metrics.totals,
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
  } finally {
    await source.close();
    await context.close();
  }
});

test("signing out removes a private watch queue and its automatic next video", async ({
  page,
}) => {
  test.setTimeout(120000);
  const source = await generateSource(2);
  try {
    const channel = await createCreator(page);
    const first = await uploadVideo(
      page,
      channel.id,
      source.payload,
      "Private queue first",
    );
    const second = await uploadVideo(
      page,
      channel.id,
      source.payload,
      "Private queue second",
    );
    const response = await page.request.post("/api/v1/playlists", {
      headers: { Origin: origin, "Idempotency-Key": crypto.randomUUID() },
      data: { title: "Personal screening queue", visibility: "private" },
    });
    expect(response.status()).toBe(201);
    const playlist = await response.json();
    let revision = playlist.revision;
    for (const video of [first, second]) {
      const added = await page.request.post(
        `/api/v1/playlists/${playlist.id}/items`,
        {
          headers: { Origin: origin },
          data: { video_id: video.id, revision },
        },
      );
      expect(added.status()).toBe(200);
      revision = (await added.json()).playlist.revision;
    }
    await page.goto(`/watch/?v=${first.id}&playlist=${playlist.id}`);
    await expect(
      page.getByRole("navigation", { name: "Playlist videos" }),
    ).toBeVisible();
    await expect(page.getByTestId("player-status")).toHaveText("Ready to play");
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("navigation", { name: "Playlist videos" }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Personal screening queue", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("This playlist is unavailable.", { exact: true }),
    ).toBeVisible();
    await page
      .locator("video")
      .evaluate((element: HTMLVideoElement) =>
        element.dispatchEvent(new Event("ended")),
      );
    await page.waitForTimeout(300);
    expect(new URL(page.url()).searchParams.get("v")).toBe(first.id);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0.2);
  } finally {
    await source.close();
  }
});
