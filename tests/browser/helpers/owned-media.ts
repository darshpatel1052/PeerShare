import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";
import type { Channel, VideoDetail, Upload } from "../../../apps/web/lib/api";
export const origin = "http://localhost:3100";
export async function register(page: Page, name = "Library viewer") {
  const response = await page.request.post("/api/v1/auth/register", {
    headers: { Origin: origin },
    data: {
      email: `${randomUUID()}@example.test`,
      password: randomBytes(24).toString("hex"),
      display_name: name,
    },
  });
  expect(response.status()).toBe(201);
}
export async function createCreator(page: Page, title = "Harbor studio") {
  await register(page, "Harbor creator");
  const response = await page.request.post("/api/v1/channels", {
    headers: { Origin: origin },
    data: {
      handle: `harbor-${randomUUID().slice(0, 8)}`,
      title,
      description: "Films and field notes.",
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Channel;
}
export async function generateSource(seconds = 6) {
  const directory = await mkdtemp(join(tmpdir(), "peerscreen-phase4-"));
  const path = join(directory, "source.mp4");
  const result = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=30",
      "-t",
      String(seconds),
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-y",
      path,
    ],
    { timeout: 30000 },
  );
  if (result.status !== 0) {
    await rm(directory, { recursive: true, force: true });
    throw new Error("Owned media fixture generation failed");
  }
  return {
    payload: await readFile(path),
    close: () => rm(directory, { recursive: true, force: true }),
  };
}
export async function uploadVideo(
  page: Page,
  channelID: string,
  payload: Buffer,
  title: string,
) {
  const size = 8 * 1024 * 1024;
  const parts: Array<Buffer> = [];
  for (let offset = 0; offset < payload.length; offset += size)
    parts.push(
      payload.subarray(offset, Math.min(offset + size, payload.length)),
    );
  const created = await page.request.post("/api/v1/uploads", {
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    data: {
      channel_id: channelID,
      title,
      description: "Owned generated test source.",
      tags: ["coast", "film"],
      size: payload.length,
      part_checksums: parts.map((part) =>
        createHash("sha256").update(part).digest("hex"),
      ),
    },
  });
  expect(created.status()).toBe(201);
  const upload = (await created.json()) as Upload;
  const grants: { parts: Array<{ token: string }> } = { parts: [] };
  for (let offset = 0; offset < parts.length; offset += 3) {
    const permission = await page.request.post(
      `/api/v1/uploads/${upload.id}/parts/presign`,
      {
        headers: { Origin: origin },
        data: {
          numbers: parts
            .slice(offset, offset + 3)
            .map((_, index) => offset + index + 1),
        },
      },
    );
    expect(permission.status()).toBe(200);
    grants.parts.push(...(await permission.json()).parts);
  }
  for (let index = 0; index < parts.length; index++) {
    const sent = await page.request.put(
      `/api/v1/uploads/${upload.id}/parts/${index + 1}`,
      {
        headers: {
          Origin: origin,
          "Content-Type": "application/octet-stream",
          "Upload-Token": grants.parts[index].token,
        },
        data: parts[index],
      },
    );
    expect(sent.status()).toBe(200);
  }
  expect(
    (
      await page.request.post(`/api/v1/uploads/${upload.id}/complete`, {
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(202);
  await expect
    .poll(
      async () => {
        const progress = await page.request.get(`/api/v1/uploads/${upload.id}`);
        return (await progress.json()).processing_state;
      },
      { timeout: 60000 },
    )
    .toBe("ready");
  expect(
    (
      await page.request.post(`/api/v1/videos/${upload.video_id}/publish`, {
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(200);
  return (await (
    await page.request.get(`/api/v1/videos/${upload.video_id}`)
  ).json()) as VideoDetail;
}
