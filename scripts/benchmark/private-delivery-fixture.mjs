import { readFile, writeFile } from "node:fs/promises";
import { privateError } from "./host.mjs";
const base = "https://peerscreen.darshpatel.dev";
try {
  const record = JSON.parse(
    await readFile(".local/benchmark/media/pipeline-v1/pipeline.json", "utf8"),
  ).results[0];
  const member = JSON.parse(
    await readFile(".local/showcase/public/sessions.json", "utf8"),
  )[0];
  const headers = { Cookie: "__Host-peerscreen_session=" + member.token };
  async function get(url) {
    if (new URL(url).origin !== base) throw Error("Unexpected origin");
    const r = await fetch(url, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error("Private benchmark media read failed: " + r.status);
    return r;
  }
  const video = await (
      await get(base + "/api/v1/videos/" + record.videoID + "/preview")
    ).json(),
    master = await (await get(video.playback.manifest_url)).text(),
    descriptor = await (await get(video.playback.integrity_url)).json(),
    streams = [];
  for (const variant of master.split("\n").filter((x) => x.endsWith(".m3u8"))) {
    const url = new URL(variant, video.playback.manifest_url),
      playlist = await (await get(url)).text(),
      paths = playlist.split("\n").filter((x) => x && !x.startsWith("#")),
      seconds = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].map((m) =>
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
    release: "0734601d6e1acaecc5527e9a35df3e63367acfb9",
    scope:
      "Existing private owned moving-video output, authenticated owner GETs only; publication unchanged",
    videoID: record.videoID,
    durationSeconds: record.inputSeconds,
    sourceSHA256: record.sourceSHA256,
    headers,
    streams,
  };
  await writeFile(
    ".local/benchmark/media/delivery-fixture.json",
    JSON.stringify(fixture, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    "Private owner-only delivery fixture prepared; no publication changed.",
  );
} catch (e) {
  await privateError("private-delivery-error.txt", e);
}
