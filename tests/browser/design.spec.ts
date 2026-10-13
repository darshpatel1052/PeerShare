import { randomUUID, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("product theme, catalogue search, channel tools and phone layouts work", async ({
  page,
  context,
  browser,
}, info) => {
  const screenshots: string[] = [];
  await mkdir(".local/screenshots/ui-redesign", { recursive: true });
  async function capture(name: string) {
    const path = `.local/screenshots/ui-redesign/${name}.png`;
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await info.attach(name, { path, contentType: "image/png" });
    screenshots.push(path);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Signal garden", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () =>
        document.fonts.check('400 14px "Manrope"') &&
        document.fonts.check('700 40px "Barlow Condensed"'),
    ),
  ).toBe(true);
  await capture("explore-desktop");
  await page
    .getByLabel("Search loaded videos")
    .fill("nothing-matches-this-title");
  await expect(
    page.getByRole("heading", { name: "No matching videos" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear video search" }).click();
  await expect(
    page.getByRole("heading", { name: "Signal garden", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Switch to dark theme" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Signal garden", exact: true }),
  ).toBeVisible();
  await capture("explore-light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("explore-mobile");
  const password = randomBytes(24).toString("hex");
  const origin = "http://localhost:3100";
  expect(
    (
      await page.request.post("/api/v1/auth/register", {
        headers: { Origin: origin },
        data: {
          email: `${randomUUID()}@example.test`,
          password,
          display_name: "Studio creator",
        },
      })
    ).status(),
  ).toBe(201);
  const response = await page.request.post("/api/v1/channels", {
    headers: { Origin: origin },
    data: {
      handle: `studio-${randomUUID().slice(0, 8)}`,
      title: "Field Notes",
      description:
        "Films, experiments, and things worth looking a little closer at.",
    },
  });
  expect(response.status()).toBe(201);
  const channel = await response.json();
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto(`/channel/?id=${channel.id}`);
  await expect(
    page.getByRole("heading", { name: "Field Notes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Edit channel", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Built one verified step at a time."),
  ).toHaveCount(0);
  await capture("channel-desktop");
  await page
    .getByRole("tab", { name: "Videos", exact: true })
    .press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "About", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "About", exact: true }).press("Home");
  await expect(
    page.getByRole("tab", { name: "Videos", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "About", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "About", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tabpanel").getByText("Studio creator", { exact: true }),
  ).toBeVisible();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin,
  });
  await page
    .getByRole("button", { name: "Share channel", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Link copied", exact: true }),
  ).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(copied).searchParams.get("id")).toBe(channel.id);
  expect(new URL(copied).origin).toBe(origin);
  await page.getByRole("tab", { name: "Videos", exact: true }).click();
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await capture("channel-light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("channel-mobile");
  await page.setViewportSize({ width: 320, height: 700 });
  await capture("channel-small-mobile");
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/account/");
  await expect(
    page.getByRole("heading", { name: "Your workspace", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Channel title", { exact: true })
    .fill("Field Notes Studio");
  await expect(page.locator(".channel-preview strong")).toHaveText(
    "Field Notes Studio",
  );
  await capture("workspace-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("workspace-mobile");
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/watch/?v=signal-garden");
  await expect(page.getByTestId("player-status")).toHaveText("Ready to play");
  await expect(page.locator("details")).not.toHaveAttribute("open", "");
  await capture("watch-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("watch-mobile");
  const anonymous = await browser.newContext({
    viewport: { width: 1365, height: 900 },
  });
  try {
    const login = await anonymous.newPage();
    await login.goto(`${origin}/account/`);
    await expect(
      login.getByRole("heading", { name: "Welcome back.", exact: true }),
    ).toBeVisible();
    await login.evaluate(() => document.fonts.ready);
    await login.screenshot({
      path: ".local/screenshots/ui-redesign/sign-in-desktop.png",
      fullPage: true,
    });
    await info.attach("sign-in-desktop", {
      path: ".local/screenshots/ui-redesign/sign-in-desktop.png",
      contentType: "image/png",
    });
    await login.setViewportSize({ width: 390, height: 844 });
    await login.screenshot({
      path: ".local/screenshots/ui-redesign/sign-in-mobile.png",
      fullPage: true,
    });
    await info.attach("sign-in-mobile", {
      path: ".local/screenshots/ui-redesign/sign-in-mobile.png",
      contentType: "image/png",
    });
    expect(
      await login.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await anonymous.close();
  }
  await info.attach("design-behavior", {
    contentType: "application/json",
    body: JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        browser: browser.version(),
        scope:
          "Production export and isolated Go/PostgreSQL/Redis; synthetic test creator, no real user account changed",
        checks: {
          localFontsLoaded: true,
          searchAndClear: true,
          themeSurvivesReload: true,
          ownerSettingsVisible: true,
          aboutTab: true,
          canonicalClipboardURL: true,
          liveTitlePreview: true,
          detailsInitiallyCollapsed: true,
          horizontalOverflow: false,
        },
        viewports: [
          { width: 1365, height: 900 },
          { width: 390, height: 844 },
          { width: 320, height: 700 },
        ],
        screenshots,
        excludes:
          "Session tokens, generated passwords, database/cache credentials",
      },
      null,
      2,
    ),
  });
});
