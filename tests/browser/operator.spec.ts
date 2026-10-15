import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createCreator, origin } from "./helpers/owned-media";

test("operator handles a real failed upload with an audited retry and loses access on sign-out", async ({
  page,
}) => {
  test.setTimeout(120000);
  const channel = await createCreator(page);
  const me = await (await page.request.get("/api/v1/me")).json();
  expect(me.user.id).toMatch(/^[a-f0-9-]{36}$/);
  const payload = Buffer.from(
      "This owned test input is deliberately not an MP4.",
    ),
    sha = createHash("sha256").update(payload).digest("hex");
  const created = await page.request.post("/api/v1/uploads", {
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    data: {
      channel_id: channel.id,
      title: "Operator handling check",
      description: "Private, deliberately invalid test source.",
      tags: [],
      size: payload.length,
      part_checksums: [sha],
    },
  });
  expect(created.status()).toBe(201);
  const upload = await created.json();
  const grants = await (
    await page.request.post(`/api/v1/uploads/${upload.id}/parts/presign`, {
      headers: { Origin: origin },
      data: { numbers: [1] },
    })
  ).json();
  const part = await page.request.put(`/api/v1/uploads/${upload.id}/parts/1`, {
    headers: {
      Origin: origin,
      "Content-Type": "application/octet-stream",
      "Upload-Token": grants.parts[0].token,
    },
    data: payload,
  });
  expect(part.status()).toBe(200);
  expect(
    (
      await page.request.post(`/api/v1/uploads/${upload.id}/complete`, {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
  ).toBe(202);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/uploads/${upload.id}`)).json())
          .processing_state,
    )
    .toBe("failed");
  execFileSync("docker", [
    "exec",
    "peerscreen-test-postgres-1",
    "psql",
    "-X",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "peerscreen_admin",
    "-d",
    "peerscreen",
    "-c",
    `UPDATE catalog.users SET role='operator' WHERE id='${me.user.id}'::uuid`,
  ]);
  await page.goto("/operator/");
  await page
    .getByRole("button", { name: "Needs attention", exact: true })
    .click();
  const job = page.locator(".operator-job").filter({
    has: page.getByRole("heading", {
      name: "Operator handling check",
      exact: true,
    }),
  });
  await expect(job).toBeVisible();
  await job
    .getByRole("button", { name: "Retry processing", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Operator note", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await job
    .getByRole("button", { name: "Retry processing", exact: true })
    .click();
  await page
    .getByLabel("Operator note", { exact: true })
    .fill("Recheck the processing source after inspection.");
  await page.getByRole("button", { name: "Queue retry", exact: true }).click();
  await expect(
    page.getByText("Video queued for processing.", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/uploads/${upload.id}`)).json())
          .processing_state,
    )
    .toBe("failed");
  const audits = execFileSync(
    "docker",
    [
      "exec",
      "peerscreen-test-postgres-1",
      "psql",
      "-X",
      "-qAt",
      "-U",
      "peerscreen_admin",
      "-d",
      "peerscreen",
      "-c",
      `SELECT count(*) FROM catalog.operator_actions WHERE actor_id='${me.user.id}'::uuid AND action='retry'`,
    ],
    { encoding: "utf8" },
  ).trim();
  expect(audits).toBe("1");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".operator-job")).toHaveCount(0);
  expect((await page.request.get("/api/v1/operator/jobs")).status()).toBe(401);
});
