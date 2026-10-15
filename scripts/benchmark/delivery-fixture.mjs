import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sql, privateError } from "./host.mjs";
const release =
  process.env.BENCHMARK_MEDIA_RELEASE ||
  "0734601d6e1acaecc5527e9a35df3e63367acfb9";
if (!/^[a-f0-9]{40}$/.test(release))
  throw Error("Set the actual full deployed release SHA");
const file = resolve(".local/benchmark/media/delivery-fixture.json"),
  base = "https://peerscreen.darshpatel.dev";
try {
  const members = JSON.parse(
    await readFile(".local/showcase/public/sessions.json", "utf8"),
  );
  const member = members[2];
  async function call(path, method = "GET", body) {
    const r = await fetch(base + "/api/v1" + path, {
      method,
      headers: {
        Cookie: "__Host-peerscreen_session=" + member.token,
        Origin: base,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    const v = text ? JSON.parse(text) : null;
    if (!r.ok)
      throw Error("Benchmark fixture " + method + " failed: " + r.status);
    return v;
  }
  if (process.argv[2] === "close") {
    const f = JSON.parse(await readFile(file, "utf8"));
    if (!f.temporaryPublic || f.ownerID !== member.id)
      throw Error("No matching temporary publication to close");
    await call("/videos/" + f.videoID + "/unpublish", "POST");
    await writeFile(
      file,
      JSON.stringify({ ...f, closedAt: new Date().toISOString() }, null, 2) +
        "\n",
      { mode: 0o600 },
    );
    console.log("Known temporary benchmark video is unpublished.");
  } else {
    const report = JSON.parse(
      await readFile(
        ".local/benchmark/media/pipeline-v1/pipeline.json",
        "utf8",
      ),
    );
    const ids = report.results
      .filter((r) => r.condition === "four-upload-burst")
      .map((r) => r.videoID);
    if (ids.some((id) => !/^[a-f0-9-]{36}$/.test(id)))
      throw Error("Invalid known benchmark ID");
    const row = JSON.parse(
      await sql(
        `SELECT row_to_json(x) FROM (SELECT v.id,u.id AS upload_id FROM catalog.videos v JOIN catalog.channels c ON c.id=v.channel_id JOIN catalog.upload_sessions u ON u.video_id=v.id WHERE c.owner_id='${member.id}'::uuid AND v.id IN (${ids.map((id) => `'${id}'::uuid`).join(",")}))x;`,
      ),
    );
    const upload = await call("/uploads/" + row.upload_id);
    await call("/videos/" + row.id, "PATCH", {
      title: "Motion study: frames in flight",
      description:
        "An owned moving test-pattern source, temporarily published for repeatable HTTP and peer-delivery measurement. No audio. This measurement video is unpublished after the experiment.",
      tags: ["motion", "benchmark"],
      revision: upload.revision,
    });
    await call("/videos/" + row.id + "/publish", "POST");
    const video = await call("/videos/" + row.id);
    const descriptor = await (await fetch(video.playback.integrity_url)).json();
    const master = await (await fetch(video.playback.manifest_url)).text();
    const variants = master.split("\n").filter((x) => x.endsWith(".m3u8"));
    const streams = [];
    for (const variant of variants) {
      const url = new URL(variant, video.playback.manifest_url),
        playlist = await (await fetch(url)).text();
      const paths = playlist.split("\n").filter((x) => x && !x.startsWith("#"));
      const seconds = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].map((m) =>
        Number(m[1]),
      );
      streams.push({
        quality: Number(variant.match(/\d+/)[0]),
        segments: paths.map((path, i) => {
          const relative = variant.split("/")[0] + "/" + path;
          return {
            path: relative,
            url: new URL(path, url).href,
            durationSeconds: seconds[i],
            ...descriptor.segments[relative],
          };
        }),
      });
    }
    const fixture = {
      preparedAt: new Date().toISOString(),
      temporaryPublic: true,
      ownerID: member.id,
      release,
      scope: "Approved temporarily public owned moving test-pattern clip",
      videoID: row.id,
      watchURL: base + "/watch/?v=" + row.id,
      durationSeconds: video.duration_seconds,
      sourceSHA256: report.results.find((r) => r.videoID === row.id)
        .sourceSHA256,
      streams,
    };
    await writeFile(file, JSON.stringify(fixture, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        temporaryPublicBenchmarkVideo: row.id,
        streams: streams.map((s) => ({
          quality: s.quality,
          segments: s.segments.length,
        })),
      }),
    );
  }
} catch (e) {
  await privateError("delivery-fixture-error.txt", e);
}
