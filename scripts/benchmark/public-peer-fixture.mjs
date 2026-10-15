import { readFile, writeFile } from "node:fs/promises";
import { privateError } from "./host.mjs";
const base = "https://peerscreen.darshpatel.dev";
try {
  const published =
    JSON.parse(
      await readFile(".local/showcase/public/published.json", "utf8"),
    ).videos.find((v) => v.slug === "adaptive-hls") ||
    JSON.parse(await readFile(".local/showcase/public/published.json", "utf8"))
      .videos[0];
  const r = await fetch(base + "/api/v1/videos/" + published.videoID);
  if (!r.ok) throw Error("Existing public video is unavailable");
  const video = await r.json(),
    playlist = await (await fetch(video.playback.manifest_url)).text();
  const variant = playlist
    .split("\n")
    .find((s) => s.startsWith("480p/") && s.endsWith(".m3u8"));
  if (!variant) throw Error("Expected a real 480p rendition");
  const stream = await (
      await fetch(new URL(variant, video.playback.manifest_url))
    ).text(),
    actualDuration = [...stream.matchAll(/#EXTINF:([\d.]+)/g)].reduce(
      (sum, m) => sum + Number(m[1]),
      0,
    );
  const fixture = {
    preparedAt: new Date().toISOString(),
    release: "0734601d6e1acaecc5527e9a35df3e63367acfb9",
    access: "existing-public",
    scope:
      "Already-published original low-motion visual explainer; not the private moving benchmark source",
    videoID: video.id,
    title: video.title,
    watchURL: base + "/watch/?v=" + video.id,
    durationSeconds: video.duration_seconds,
    actualHLSDurationSeconds: actualDuration,
    sourceSHA256: published.sourceSHA256,
    sourceBytes: published.sourceBytes,
  };
  await writeFile(
    ".local/benchmark/media/peer-fixture.json",
    JSON.stringify(fixture, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      existingPublicVideo: video.title,
      actualHLSDurationSeconds: actualDuration,
      publicationChanged: false,
    }),
  );
} catch (e) {
  await privateError("public-peer-fixture-error.txt", e);
}
