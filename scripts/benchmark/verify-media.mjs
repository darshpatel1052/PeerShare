import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { sql, privateError } from "./host.mjs";
const label = process.argv[2] || "pipeline-v1";
if (!/^[a-z0-9-]{1,40}$/.test(label)) throw Error("Invalid measurement label");
const directory = resolve(".local/benchmark/media", label),
  report = JSON.parse(await readFile(join(directory, "pipeline.json"), "utf8"));
const members = JSON.parse(
  await readFile(".local/showcase/public/sessions.json", "utf8"),
);
try {
  const ids = report.results.map((r) => r.videoID);
  if (ids.length !== 7 || ids.some((id) => !/^[a-f0-9-]{36}$/.test(id)))
    throw Error("Expected the seven known benchmark IDs");
  const metadata = JSON.parse(
    await sql(
      `SELECT json_agg(json_build_object('id',v.id,'ownerID',c.owner_id,'durationSeconds',v.duration_seconds,'qualities',v.qualities,'processingState',v.processing_state,'publicationState',v.publication_state)) FROM catalog.videos v JOIN catalog.channels c ON c.id=v.channel_id WHERE v.id IN (${ids.map((id) => `'${id}'::uuid`).join(",")});`,
    ),
  );
  const verified = [];
  for (const record of report.results) {
    const video = metadata.find((v) => v.id === record.videoID),
      member = members.find((m) => m.id === video.ownerID);
    if (
      !member ||
      video.processingState !== "ready" ||
      video.publicationState !== "draft" ||
      JSON.stringify(video.qualities) !== "[480,720]"
    )
      throw Error("Unexpected benchmark output state");
    async function fetchOwned(url) {
      if (new URL(url).origin !== "https://peerscreen.darshpatel.dev")
        throw Error("Unexpected media origin");
      const r = await fetch(url, {
        headers: { Cookie: "__Host-peerscreen_session=" + member.token },
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      if (!r.ok) throw Error("Output verification failed: " + r.status);
      return r;
    }
    const preview = await (
      await fetchOwned(
        "https://peerscreen.darshpatel.dev/api/v1/videos/" +
          video.id +
          "/preview",
      )
    ).json();
    const master = await (
        await fetchOwned(preview.playback.manifest_url)
      ).text(),
      descriptor = await (
        await fetchOwned(preview.playback.integrity_url)
      ).json();
    const qualities = [...master.matchAll(/RESOLUTION=\d+x(\d+)/g)]
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
    if (JSON.stringify(qualities) !== "[480,720]")
      throw Error("Master playlist is missing an expected rendition");
    const segments = [];
    for (const q of qualities) {
      const entries = Object.entries(descriptor.segments)
        .filter(([path]) => path.startsWith(String(q) + "p/"))
        .sort();
      if (!entries.length) throw Error("No rendition segments");
      for (const [path, expected] of [entries[0], entries.at(-1)]) {
        const payload = Buffer.from(
          await (
            await fetchOwned(new URL(path, preview.playback.integrity_url))
          ).arrayBuffer(),
        );
        const hash = createHash("sha256").update(payload).digest("hex");
        if (payload.length !== expected.bytes || hash !== expected.sha256)
          throw Error("Output segment integrity failed");
        segments.push({
          path,
          bytes: payload.length,
          sha256: hash,
          verified: true,
        });
      }
    }
    verified.push({
      videoID: video.id,
      durationSeconds: video.durationSeconds,
      qualities,
      segmentCount: Object.keys(descriptor.segments).length,
      sampledSegments: segments,
      processingState: video.processingState,
      publicationState: video.publicationState,
    });
  }
  await writeFile(
    join(directory, "output-verification.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        sourcePipelineReportSHA256: createHash("sha256")
          .update(await readFile(join(directory, "pipeline.json")))
          .digest("hex"),
        scope:
          "Read-back verification after pipeline timing; two real renditions and first/last segment hashes for each upload",
        verified,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      verifiedUploads: verified.length,
      renditions: verified.length * 2,
      verifiedSegments: verified.reduce(
        (n, v) => n + v.sampledSegments.length,
        0,
      ),
    }),
  );
} catch (e) {
  await privateError("verify-media-error.txt", e);
}
