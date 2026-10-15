import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const origin = "http://localhost:3100";
test("Google availability is honest and callback errors explain account linking", async ({
  page,
}) => {
  await page.goto("/account/");
  await expect(
    page.getByRole("button", { name: "Sign in with Google", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Google sign-in is currently unavailable.", { exact: true }),
  ).toBeVisible();
  await page.goto("/account/?auth_error=link_required");
  await expect(
    page.getByRole("alert").filter({
      hasText: "Sign in with your password, then connect Google in Settings",
    }),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.has("auth_error"))
    .toBe(false);
  await page.route("**/api/v1/auth/options", (route) =>
    route.fulfill({
      json: { google_enabled: true, registration_enabled: false },
    }),
  );
  await page.reload();
  await expect(
    page.getByText("PeerScreen is currently invite-only.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create an account", exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/api/v1/auth/options");
  await page.route("**/api/v1/auth/options", (route) =>
    route.fulfill({
      json: { google_enabled: true, registration_enabled: true },
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sign in with Google", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Sign in with Google", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "You can sign in with email instead." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with Google", exact: true }),
  ).toBeEnabled();
});

test("Workspace settings contain Appearance and password-confirmed Google connection", async ({
  page,
}, info) => {
  const password = "settings test password 123";
  expect(
    (
      await page.request.post("/api/v1/auth/register", {
        headers: { Origin: origin },
        data: {
          email: `${randomUUID()}@example.test`,
          password,
          display_name: "Settings creator",
        },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/");
  expect(
    await page
      .locator("header")
      .getByRole("button", { name: /theme/i })
      .count(),
  ).toBe(0);
  const workspace = page.getByRole("button", {
    name: "Workspace",
    exact: true,
  });
  await workspace.click();
  await expect(workspace).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(workspace).toHaveAttribute("aria-expanded", "false");
  await expect(workspace).toBeFocused();
  await workspace.click();
  await page
    .getByRole("navigation", { name: "Workspace menu" })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Your password sign-in remains available.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.screenshot({
    path: ".local/screenshots/ui-redesign/settings-light.png",
    fullPage: true,
  });
  await info.attach("settings-light", {
    path: ".local/screenshots/ui-redesign/settings-light.png",
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/screenshots/ui-redesign/settings-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  // Only the availability response is controlled here. Real provider exchange and signature checks
  // are covered by Go integration tests with an RSA-signed local provider; no fake login success.
  await page.route("**/api/v1/auth/options", (route) =>
    route.fulfill({
      json: { google_enabled: true, registration_enabled: true },
    }),
  );
  await page.reload();
  await expect(
    page.getByLabel("Confirm your password", { exact: true }),
  ).toBeVisible();
  let calls = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/auth/google/link")) calls++;
  });
  await page
    .getByRole("button", { name: "Sign in with Google", exact: true })
    .click();
  expect(calls).toBe(0);
  await page
    .getByLabel("Confirm your password", { exact: true })
    .fill(password);
  await page
    .getByRole("button", { name: "Sign in with Google", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Google sign-in is currently unavailable." }),
  ).toBeVisible();
  expect(calls).toBe(1);
  await info.attach("google-ui-scope", {
    contentType: "application/json",
    body: JSON.stringify({
      appearanceUnderSettings: true,
      themeSurvivesReload: true,
      workspaceEscapeDismissal: true,
      passwordRequiredBeforeConnection: true,
      unconfiguredProviderIsDisabled: true,
      serviceErrorRecoverable: true,
      liveGoogleLogin: false,
      providerVerification: "Go integration suite with real RSA signatures",
      secretsExcluded: true,
    }),
  });
});
