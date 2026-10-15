// Capture real UI interactions or rasterize the editable delivery illustration.
// GIF is used for GitHub motion; SVG remains the editable diagram source.
import { chromium, expect } from "@playwright/test";
import { mkdir, readdir, rm, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const output = resolve("docs/assets/readme");
const scratch = resolve(".local/readme");
const tour = process.argv[2] === "tour";
await mkdir(output, { recursive: true });
await mkdir(scratch, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  if (!tour) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1200 },
    });
    for (const name of [
      "hero-light",
      "hero-dark",
      "architecture-light",
      "architecture-dark",
      "benchmarks-light",
      "benchmarks-dark",
    ]) {
      await page.goto(pathToFileURL(resolve(output, name + ".svg")).href);
      await page
        .locator("svg")
        .screenshot({ path: resolve(scratch, name + ".png") });
    }
    const frames = resolve(scratch, "peer-frames");
    await mkdir(frames, { recursive: true });
    await page.goto(pathToFileURL(resolve(output, "peer-delivery.svg")).href);
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.evaluate(() => {
      const svg = document.documentElement;
      svg.style.background = "#151c19";
      svg.pauseAnimations();
    });
    for (let frame = 0; frame < 60; frame++) {
      await page.evaluate(
        (t) => document.documentElement.setCurrentTime(t),
        3 + frame / 15,
      );
      await page.screenshot({
        path: resolve(frames, String(frame).padStart(3, "0") + ".png"),
      });
    }
    await run(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-framerate",
        "15",
        "-i",
        resolve(frames, "%03d.png"),
        "-filter_complex",
        "scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5",
        "-loop",
        "0",
        resolve(output, "peer-delivery.gif"),
      ],
      { timeout: 120000 },
    );
    console.log(
      "Rendered diagram previews and the looping delivery illustration.",
    );
  } else {
    // This capture is public local browsing only: no credentials or DB writes.
    const base = "http://localhost:3000";
    const response = await fetch(base + "/api/v1/videos?q=hls&limit=3");
    if (!response.ok)
      throw Error("Start the populated local application first");
    const video = (await response.json()).items[0];
    if (!video || video.source_kind === "fixture")
      throw Error("An actual published HLS showcase video is required");
    const recording = resolve(scratch, "tour-video");
    await rm(recording, { recursive: true, force: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: "light",
      recordVideo: { dir: recording, size: { width: 1280, height: 800 } },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base, { waitUntil: "networkidle" });
    await page.mouse.move(870, 240);
    await page.waitForTimeout(2200);
    await page.mouse.wheel(0, 560);
    await page.waitForTimeout(1600);
    await page.mouse.wheel(0, -560);
    await page.waitForTimeout(700);
    await page
      .getByRole("textbox", { name: "Search videos" })
      .pressSequentially("HLS", { delay: 150 });
    await page.getByText("Search results", { exact: true }).waitFor();
    await page.waitForTimeout(1500);
    await page
      .getByRole("link", { name: "Watch " + video.title, exact: true })
      .click();
    await expect(page.getByTestId("player-status")).toHaveText(
      "Ready to play",
      { timeout: 30000 },
    );
    await page.getByRole("button", { name: "Play video", exact: true }).click();
    await page.waitForTimeout(3000);
    await page.locator("video").hover();
    await page.getByLabel("Video quality").selectOption("480");
    await page.waitForTimeout(1400);
    await page.getByText("Connection details", { exact: true }).click();
    await page.getByTestId("http-bytes").scrollIntoViewIfNeeded();
    await page.waitForTimeout(2400);
    await page.goto(base + "/channel/?id=" + video.channel_id, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2500);
    await page.mouse.wheel(0, 380);
    await page.waitForTimeout(1800);
    const recordingPath = await page.video().path();
    await context.close();
    if (errors.length)
      throw Error("Product capture had page errors: " + errors.join("; "));
    const filter =
      "fps=10,scale=960:-1:flags=lanczos,pad=960:ih+44:0:44:color=0x151c19,drawtext=fontfile=apps/web/public/fonts/manrope-variable.ttf:text='PEERSHARE   /   EXPLORE · SEARCH · WATCH · DISCOVER CREATORS':fontsize=13:fontcolor=0xf5f2e9:x=20:y=14,split[a][b];[a]palettegen=max_colors=160[p];[b][p]paletteuse=dither=bayer:bayer_scale=5";
    await run(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-i",
        recordingPath,
        "-filter_complex",
        filter,
        "-loop",
        "0",
        resolve(output, "product-tour.gif"),
      ],
      { timeout: 180000 },
    );
    await writeFile(
      resolve(output, "capture.json"),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          base,
          browser: browser.version(),
          viewport: { width: 1280, height: 800 },
          scope:
            "Actual anonymous local browsing of the retained editorial catalogue: discovery, search, playback, connection details and a public channel. No fabricated engagement or account activity; peer exchange is illustrated separately.",
          videoID: video.id,
          pageErrors: errors,
        },
        null,
        2,
      ) + "\n",
    );
    console.log("Captured a real product walkthrough.");
  }
  const assets = await readdir(output);
  console.log(
    JSON.stringify(
      await Promise.all(
        assets
          .filter((f) => f.endsWith(".gif"))
          .map(async (name) => ({
            name,
            bytes: (await stat(resolve(output, name))).size,
          })),
      ),
    ),
  );
} finally {
  await browser.close();
}
