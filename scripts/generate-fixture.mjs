import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve(".local/media/fixture");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

function ffmpeg(args) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args],
    { stdio: "inherit", timeout: 120_000 },
  );
  if (result.error || result.status !== 0)
    throw (
      result.error ??
      new Error("FFmpeg failed. Install FFmpeg with libx264 and AAC.")
    );
}

// Generated locally: no third-party footage, network inputs, or user metadata.
for (const [height, width, bitrate] of [
  [480, 854, "1600k"],
  [360, 640, "900k"],
]) {
  const directory = resolve(output, `${height}p`);
  await mkdir(directory, { recursive: true });
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=854x480:rate=24:duration=60",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=60",
    "-vf",
    `scale=${width}:${height}`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-threads",
    "2",
    "-b:v",
    bitrate,
    "-pix_fmt",
    "yuv420p",
    "-g",
    "96",
    "-keyint_min",
    "96",
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-f",
    "hls",
    "-hls_time",
    "4",
    "-hls_playlist_type",
    "vod",
    "-hls_flags",
    "independent_segments",
    "-hls_segment_filename",
    resolve(directory, "segment-%03d.ts"),
    resolve(directory, "index.m3u8"),
  ]);
}
ffmpeg([
  "-i",
  resolve(output, "480p/segment-000.ts"),
  "-frames:v",
  "1",
  "-q:v",
  "3",
  resolve(output, "thumbnail.jpg"),
]);
await writeFile(
  resolve(output, "master.m3u8"),
  '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"\n360p/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=854x480,CODECS="avc1.64001e,mp4a.40.2"\n480p/index.m3u8\n',
);

const segments = {};
for (const variant of ["360p", "480p"]) {
  for (const name of (await readdir(resolve(output, variant)))
    .filter((name) => name.endsWith(".ts"))
    .sort()) {
    const bytes = await readFile(resolve(output, variant, name));
    segments[`${variant}/${name}`] = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    };
  }
}
const mediaVersion = createHash("sha256")
  .update(JSON.stringify(segments))
  .digest("hex");
await writeFile(
  resolve(output, "integrity.json"),
  JSON.stringify({ schemaVersion: 1, mediaVersion, segments }, null, 2) + "\n",
);
await writeFile(
  resolve(output, "fixture.json"),
  JSON.stringify(
    {
      generated: true,
      duration: 60,
      source: "FFmpeg lavfi testsrc2 + sine",
      recipe: "fixture-v1",
      renditions: [360, 480],
      mediaVersion,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Generated ${Object.keys(segments).length} real HLS segments. Media version: ${mediaVersion}`,
);
