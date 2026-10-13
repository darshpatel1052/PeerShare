import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const origin = "http://localhost:3100";
const password = "a browser test passphrase 123";
async function registerThroughUI(page: Page) {
  const email = `${randomUUID()}@example.test`;
  await page.goto("/account/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByLabel("Display name", { exact: true })
    .fill("Learning creator");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your workspace" }),
  ).toBeVisible();
  return email;
}
async function createThroughUI(page: Page) {
  const handle = `learning-${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Channel handle", { exact: true }).fill(handle);
  await page
    .getByLabel("Channel title", { exact: true })
    .fill("My learning channel");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Real persisted channel metadata.");
  await page
    .getByRole("button", { name: "Create channel", exact: true })
    .click();
  await expect(page.getByTestId("account-notice")).toHaveText(
    "Your channel is ready.",
  );
  return handle;
}

test("register, create, reload, edit, sign out and sign in through the production UI", async ({
  page,
  context,
}, info) => {
  const email = await registerThroughUI(page);
  await createThroughUI(page);
  const meResponse = await page.request.get("/api/v1/me");
  expect(meResponse.status()).toBe(200);
  const initial = await meResponse.json();
  const session = (await context.cookies()).find(
    (cookie) => cookie.name === "peerscreen_session",
  );
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "peerscreen_session",
  );
  await page.getByRole("link", { name: "View your channel" }).click();
  await expect(
    page.getByRole("heading", { name: "My learning channel", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "My learning channel", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No videos have been published on this channel yet."),
  ).toBeVisible();
  await page.goto("/account/");
  await page
    .getByLabel("Channel title", { exact: true })
    .fill("Updated learning channel");
  await page.getByRole("button", { name: "Save channel", exact: true }).click();
  await expect(page.getByTestId("account-notice")).toHaveText(
    "Channel settings saved.",
  );
  await page.reload();
  await expect(page.getByLabel("Channel title", { exact: true })).toHaveValue(
    "Updated learning channel",
  );
  const updated = await (await page.request.get("/api/v1/me")).json();
  expect(updated.channel.id).toBe(initial.channel.id);
  expect(updated.channel.revision).toBe(2);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Channel title", { exact: true })).toHaveValue(
    "Updated learning channel",
  );
  await info.attach("identity-journey", {
    contentType: "application/json",
    body: JSON.stringify(
      {
        initialAccount: initial,
        afterEdit: updated,
        browserReloadPreservedChannel: true,
        loggedOutMeStatus: 401,
        loginRestoredChannel: true,
        cookie: {
          httpOnly: session?.httpOnly,
          sameSite: session?.sameSite,
          secure: session?.secure,
          path: session?.path,
        },
        scope:
          "production export, real Go API and isolated PostgreSQL/Redis; original cookie values/passwords excluded",
      },
      null,
      2,
    ),
  });
});

test("a second owner is denied and a stale form preserves its unsaved edit", async ({
  browser,
}) => {
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  try {
    const first = await alice.newPage();
    const second = await alice.newPage();
    await registerThroughUI(first);
    await createThroughUI(first);
    const me = await (await first.request.get("/api/v1/me")).json();
    const bobRegistration = await bob.request.post(
      `${origin}/api/v1/auth/register`,
      {
        headers: { Origin: origin },
        data: {
          email: `${randomUUID()}@example.test`,
          password,
          display_name: "Other creator",
        },
      },
    );
    expect(bobRegistration.status()).toBe(201);
    const forbidden = await bob.request.patch(
      `${origin}/api/v1/channels/${me.channel.id}`,
      {
        headers: { Origin: origin, "X-User-ID": me.user.id },
        data: { title: "Forged edit", description: "forbidden", revision: 1 },
      },
    );
    expect(forbidden.status()).toBe(403);
    expect((await forbidden.json()).code).toBe("not_owner");
    await second.goto("/account/");
    await expect(
      second.getByLabel("Channel title", { exact: true }),
    ).toHaveValue("My learning channel");
    await first
      .getByLabel("Channel title", { exact: true })
      .fill("The first saved edit");
    await first
      .getByRole("button", { name: "Save channel", exact: true })
      .click();
    await expect(first.getByTestId("account-notice")).toHaveText(
      "Channel settings saved.",
    );
    await second
      .getByLabel("Channel title", { exact: true })
      .fill("My unsaved stale edit");
    await second
      .getByRole("button", { name: "Save channel", exact: true })
      .click();
    await expect(second.getByTestId("account-error")).toContainText(
      "changed since you opened it",
    );
    await expect(
      second.getByLabel("Channel title", { exact: true }),
    ).toHaveValue("My unsaved stale edit");
    expect(
      (
        await (
          await second.request.get(`/api/v1/channels/${me.channel.id}`)
        ).json()
      ).title,
    ).toBe("The first saved edit");
    await second.getByRole("button", { name: "Reload channel" }).click();
    await expect(
      second.getByLabel("Channel title", { exact: true }),
    ).toHaveValue("The first saved edit");
    await expect(second.getByTestId("account-error")).toHaveCount(0);
  } finally {
    await alice.close();
    await bob.close();
  }
});

test("controlled failed requests preserve channel fields and catalogue retry recovers", async ({
  page,
}) => {
  await registerThroughUI(page);
  const handle = `retry-${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Channel handle", { exact: true }).fill(handle);
  await page
    .getByLabel("Channel title", { exact: true })
    .fill("Keep this title");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Keep this description");
  await page.route(
    "**/api/v1/channels",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "injected_test_failure",
          message: "Temporary test failure",
          request_id: randomUUID(),
        }),
      }),
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "Create channel", exact: true })
    .click();
  await expect(page.getByTestId("account-error")).toContainText(
    "Temporary test failure",
  );
  await expect(page.getByLabel("Channel handle", { exact: true })).toHaveValue(
    handle,
  );
  await expect(page.getByLabel("Channel title", { exact: true })).toHaveValue(
    "Keep this title",
  );
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "Keep this description",
  );
  await page
    .getByRole("button", { name: "Create channel", exact: true })
    .click();
  await expect(page.getByTestId("account-notice")).toHaveText(
    "Your channel is ready.",
  );
  await page.route(
    "**/api/v1/videos?*",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "injected_test_failure",
          message: "Catalogue test failure",
          request_id: randomUUID(),
        }),
      }),
    { times: 1 },
  );
  await page.goto("/");
  await expect(page.getByTestId("catalogue-error")).toContainText(
    "Catalogue test failure",
  );
  await page.getByRole("button", { name: "Retry videos" }).click();
  await expect(
    page.getByRole("heading", { name: "Signal garden", exact: true }),
  ).toBeVisible();
});
