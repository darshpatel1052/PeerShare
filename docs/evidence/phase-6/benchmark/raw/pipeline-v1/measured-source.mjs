import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { privateError, execute, sshOptions, hostTarget } from "./host.mjs";
const exec = promisify(execFile),
  root = resolve(".local/benchmark/media");
const profiles = [
  { name: "720p-30s", width: 1280, height: 720, seconds: 30, bitrate: "2500k" },
  {
    name: "1080p-60s",
    width: 1920,
    height: 1080,
    seconds: 60,
    bitrate: "5000k",
  },
  {
    name: "1080p-120s",
    width: 1920,
    height: 1080,
    seconds: 120,
    bitrate: "5000k",
  },
];
await mkdir(root, { recursive: true, mode: 0o700 });
let sampler;
const scriptSHA256 = createHash("sha256")
  .update(await readFile(new URL(import.meta.url)))
  .digest("hex");
try {
  if (process.argv[2] === "prepare") {
    const sources = [];
    for (const p of profiles) {
      const file = join(root, p.name + ".mp4");
      await exec(
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
          `testsrc2=size=${p.width}x${p.height}:rate=30`,
          "-t",
          String(p.seconds),
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-threads",
          "2",
          "-b:v",
          p.bitrate,
          "-maxrate",
          p.bitrate,
          "-bufsize",
          "10M",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          file,
        ],
        { timeout: 300000 },
      );
      const payload = await readFile(file),
        probe = JSON.parse(
          (
            await exec("ffprobe", [
              "-v",
              "error",
              "-show_streams",
              "-show_format",
              "-of",
              "json",
              file,
            ])
          ).stdout,
        );
      sources.push({
        ...p,
        file,
        bytes: payload.length,
        sha256: createHash("sha256").update(payload).digest("hex"),
        probe,
      });
      console.log(
        "Prepared owned moving source " +
          p.name +
          " (" +
          payload.length +
          " bytes).",
      );
    }
    await writeFile(
      join(root, "sources.json"),
      JSON.stringify(sources, null, 2) + "\n",
      { mode: 0o600 },
    );
  } else {
    const label = process.argv[2] || "pipeline-v1";
    if (!/^[a-z0-9-]{1,40}$/.test(label))
      throw Error("Use a unique bounded campaign label");
    const release = process.env.MEDIA_SOURCE_RELEASE;
    if (!/^[a-f0-9]{40}$/.test(release || ""))
      throw Error("Set the actual deployed MEDIA_SOURCE_RELEASE");
    const directory = join(root, label);
    await mkdir(directory, { mode: 0o700 });
    const target = await hostTarget();
    await execute("scp", [
      ...sshOptions,
      "scripts/benchmark/sample-host.py",
      target + ":/home/ubuntu/peerscreen-benchmark/sample-host.py",
    ]);
    sampler = spawn(
      "ssh",
      [
        ...sshOptions,
        target,
        "sudo timeout 1800 python3 /home/ubuntu/peerscreen-benchmark/sample-host.py all",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    sampler.stdout.pipe(
      createWriteStream(join(directory, "resources.jsonl"), { mode: 0o600 }),
    );
    const sources = JSON.parse(
      await readFile(join(root, "sources.json"), "utf8"),
    );
    const members = JSON.parse(
      await readFile(".local/showcase/public/sessions.json", "utf8"),
    );
    const base = "https://peerscreen.darshpatel.dev";
    async function call(
      member,
      path,
      { method = "GET", body, headers = {} } = {},
    ) {
      const binary = Buffer.isBuffer(body),
        r = await fetch(base + "/api/v1" + path, {
          method,
          headers: {
            Cookie: "__Host-peerscreen_session=" + member.token,
            Origin: base,
            ...(body
              ? {
                  "Content-Type": binary
                    ? "application/octet-stream"
                    : "application/json",
                }
              : {}),
            ...headers,
          },
          body: body ? (binary ? body : JSON.stringify(body)) : undefined,
          signal: AbortSignal.timeout(120000),
        });
      const value = (r.headers.get("content-type") || "").includes(
        "application/json",
      )
        ? await r.json()
        : null;
      if (!r.ok)
        throw Error(
          method +
            " " +
            path +
            " returned " +
            r.status +
            " " +
            (value?.error?.code || ""),
        );
      return value;
    }
    const results = [];
    const save = () =>
      writeFile(
        join(directory, "pipeline.json"),
        JSON.stringify(
          {
            checkedAt: new Date().toISOString(),
            release,
            scriptSHA256,
            hardware:
              "Existing AWS m7i-flex.large, 2 vCPU / 8 GiB; normal services share this host",
            scope:
              "Actual production uploads/transcodes of owned synthetic moving sources; unpublished",
            results,
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
    async function upload(source, member, condition) {
      const payload = await readFile(source.file),
        parts = [];
      for (let i = 0; i < payload.length; i += 8 * 1024 * 1024)
        parts.push(payload.subarray(i, i + 8 * 1024 * 1024));
      const me = await call(member, "/me"),
        started = Date.now();
      const u = await call(member, "/uploads", {
        method: "POST",
        body: {
          channel_id: me.channel.id,
          title: `Motion benchmark · ${source.name}`,
          description:
            "Owned generated moving-video source for a reproducible production processing measurement. Private benchmark upload.",
          tags: ["benchmark", "motion"],
          size: payload.length,
          part_checksums: parts.map((p) =>
            createHash("sha256").update(p).digest("hex"),
          ),
        },
        headers: { "Idempotency-Key": randomUUID() },
      });
      const record = {
        condition,
        profile: source.name,
        sourceBytes: payload.length,
        sourceSHA256: source.sha256,
        inputWidth: source.width,
        inputHeight: source.height,
        inputFPS: 30,
        inputSeconds: source.seconds,
        uploadID: u.id,
        videoID: u.video_id,
        startedAt: new Date(started).toISOString(),
        stages: [],
      };
      results.push(record);
      await save();
      for (let offset = 0; offset < parts.length; offset += 3) {
        const numbers = parts
          .slice(offset, offset + 3)
          .map((_, i) => offset + i + 1);
        const grants = (
          await call(member, `/uploads/${u.id}/parts/presign`, {
            method: "POST",
            body: { numbers },
          })
        ).parts;
        for (let i = 0; i < numbers.length; i++)
          await call(member, `/uploads/${u.id}/parts/${numbers[i]}`, {
            method: "PUT",
            body: parts[numbers[i] - 1],
            headers: { "Upload-Token": grants[i].token },
          });
      }
      await call(member, `/uploads/${u.id}/complete`, { method: "POST" });
      const uploadedAt = Date.now();
      record.uploadMS = uploadedAt - started;
      while (Date.now() - uploadedAt < 600000) {
        const state = await call(member, `/uploads/${u.id}`),
          stage = state.processing_state + "/" + state.processing_stage;
        if (record.stages.at(-1)?.state !== stage)
          record.stages.push({
            state: stage,
            sinceCompleteMS: Date.now() - uploadedAt,
          });
        if (state.processing_state === "ready") {
          const preview = await call(member, `/videos/${u.video_id}/preview`);
          record.processingWaitMS = Date.now() - uploadedAt;
          record.totalMS = Date.now() - started;
          record.readyAt = new Date().toISOString();
          record.durationSeconds = preview.duration_seconds;
          record.qualities = preview.qualities;
          record.publicationState = state.publication_state;
          record.ready = true;
          await save();
          console.log(
            JSON.stringify({
              condition,
              profile: source.name,
              uploadMS: record.uploadMS,
              processingWaitMS: record.processingWaitMS,
              qualities: record.qualities,
            }),
          );
          return;
        }
        if (["failed", "cancelled"].includes(state.processing_state)) {
          record.ready = false;
          record.failure = state.error_code;
          await save();
          throw Error(
            "Actual processing failed: " + source.name + " " + state.error_code,
          );
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      record.ready = false;
      await save();
      throw Error("Processing measurement exceeded ten-minute deadline");
    }
    for (let i = 0; i < sources.length; i++)
      await upload(sources[i], members[i], "sequential");
    const burst = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) =>
        upload(sources[0], members[i], "four-upload-burst"),
      ),
    );
    if (burst.some((r) => r.status === "rejected"))
      throw Error(
        "At least one burst upload failed; all outcomes are retained",
      );
    console.log(
      "Actual media pipeline measurement complete. All seven benchmark uploads remain private.",
    );
  }
} catch (e) {
  await privateError("media-error.txt", e);
} finally {
  sampler?.kill("SIGTERM");
}
