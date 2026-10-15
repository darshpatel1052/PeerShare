import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { series } from "./catalogue.mjs";
const run = promisify(execFile),
  root = resolve(".local/showcase");
const xml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function lines(text, max = 32) {
  const result = [];
  for (const word of text.split(" ")) {
    if (!result.length || result.at(-1).length + word.length + 1 > max)
      result.push(word);
    else result[result.length - 1] += " " + word;
  }
  return result;
}
const text = (
  value,
  x,
  y,
  size = 30,
  color = "#f4f4ef",
  max = 38,
  weight = 500,
) =>
  lines(value, max)
    .map(
      (line, i) =>
        `<text x="${x}" y="${y + i * size * 1.2}" font-size="${size}" fill="${color}" font-weight="${weight}">${xml(line)}</text>`,
    )
    .join("");
function art(channel, chapter = 0) {
  const a = channel.accent;
  const active = chapter % 4;
  let s = "";
  if (channel.motif === "bars" || channel.motif === "grid") {
    for (let i = 0; i < 6; i++)
      s += `<rect x="${760 + (i % 3) * 130}" y="${205 + Math.floor(i / 3) * 150}" width="112" height="${channel.motif === "grid" ? 126 : 70 + (i % 3) * 28}" rx="13" fill="${i % 4 === active ? a : "#ffffff0e"}" stroke="#ffffff18"/><text x="${786 + (i % 3) * 130}" y="${253 + Math.floor(i / 3) * 150}" fill="${i % 4 === active ? channel.shade : "#a7b0c0"}" font-size="20">0${i + 1}</text>`;
  } else if (channel.motif === "frames") {
    for (let i = 0; i < 4; i++)
      s += `<rect x="${770 + i * 37}" y="${200 + i * 55}" width="275" height="170" rx="18" fill="${channel.shade}" stroke="${i === active ? a : "#ffffff30"}" stroke-width="2"/><rect x="${795 + i * 37}" y="${225 + i * 55}" width="${130 + i * 19}" height="5" rx="2" fill="${a}" opacity="${0.4 + i * 0.15}"/><circle cx="${910 + i * 37}" cy="${290 + i * 55}" r="24" fill="${a}" opacity=".12"/>`;
  } else {
    const points =
      channel.motif === "queue"
        ? [
            [760, 280],
            [890, 280],
            [1020, 280],
            [1150, 280],
          ]
        : [
            [810, 225],
            [1090, 225],
            [810, 465],
            [1090, 465],
          ];
    for (let i = 0; i < points.length - 1; i++)
      s += `<path d="M ${points[i][0]} ${points[i][1]} L ${points[i + 1][0]} ${points[i + 1][1]}" stroke="${a}" stroke-width="2" opacity=".4"/>`;
    points.forEach(([x, y], i) => {
      s += `<circle cx="${x}" cy="${y}" r="${i === active ? 51 : 38}" fill="${i === active ? a : channel.shade}" stroke="${a}" stroke-width="${i === active ? 0 : 1}"/><text x="${x}" y="${y + 8}" text-anchor="middle" font-size="24" fill="${i === active ? channel.shade : a}" font-weight="600">0${i + 1}</text>`;
    });
  }
  return s;
}
function frame(channel, video, chapter, cover = false) {
  const part = video.chapters[chapter];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><radialGradient id="glow"><stop stop-color="${channel.accent}" stop-opacity=".15"/><stop offset="1" stop-color="${channel.shade}" stop-opacity="0"/></radialGradient></defs><rect width="1280" height="720" fill="#10151c"/><rect x="695" width="585" height="720" fill="${channel.shade}"/><circle cx="1050" cy="360" r="400" fill="url(#glow)"/><g font-family="DejaVu Sans, sans-serif">${text(channel.title.toUpperCase(), 64, 65, 17, channel.accent, 60, 600)}<rect x="64" y="105" width="44" height="4" rx="2" fill="${channel.accent}"/>${text(cover ? video.title : part[0], 64, 185, cover ? 53 : 43, "#f4f4ef", cover ? 22 : 25, 600)}${cover ? text(video.tag + " / VISUAL NOTES", 64, 540, 17, "#a5afbe", 50) : text(part[1], 64, 385, 23, "#c6ccd5", 43) + text(part[2], 64, 485, 23, "#8995a5", 43)}${art(channel, chapter)}<path d="M64 632 H1216" stroke="#ffffff18"/>${text(cover ? "ORIGINAL SERIES" : `${String(chapter + 1).padStart(2, "0")} / 04`, 64, 676, 15, "#8995a5", 50)}${text(cover ? "PEERSCREEN" : "VISUAL EXPLANATION · NO AUDIO", 860, 676, 13, "#8995a5", 50)}</g></svg>`;
}
await mkdir(root, { recursive: true, mode: 0o700 });
const manifest = [];
for (const channel of series) {
  const directory = join(root, channel.slug);
  await mkdir(directory, { recursive: true });
  const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"><rect width="1600" height="400" fill="${channel.shade}"/><circle cx="1370" cy="40" r="330" fill="${channel.accent}" opacity=".1"/><circle cx="1370" cy="40" r="230" stroke="${channel.accent}" stroke-width="2" fill="none" opacity=".4"/><circle cx="1370" cy="40" r="130" stroke="${channel.accent}" fill="none" opacity=".5"/><g font-family="DejaVu Sans, sans-serif">${text(channel.title, 80, 177, 67, "#f4f4ef", 50, 600)}${text("IDEAS, MADE VISIBLE.", 84, 240, 19, channel.accent, 80)}${text("A PEERSCREEN SHOWCASE SERIES", 84, 334, 13, "#b7bdc9", 80)}</g></svg>`;
  await sharp(Buffer.from(banner)).png().toFile(join(directory, "banner.png"));
  for (const [index, video] of channel.videos.entries()) {
    const folder = join(directory, video.slug);
    await mkdir(folder, { recursive: true });
    await sharp(Buffer.from(frame(channel, video, 0, true)))
      .png()
      .toFile(join(folder, "thumbnail.png"));
    const source = join(folder, "source.mp4");
    try {
      await stat(source);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
      for (let i = 0; i < 4; i++) {
        const file = join(folder, `frame-${i}.png`);
        await sharp(Buffer.from(frame(channel, video, i)))
          .png()
          .toFile(file);
        args.push("-loop", "1", "-framerate", "24", "-t", "8", "-i", file);
      }
      const filters = [];
      for (let i = 0; i < 4; i++)
        filters.push(
          `[${i}:v]format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${i}]`,
        );
      filters.push(
        "[v0][v1]xfade=transition=fade:duration=0.4:offset=7.6[x1]",
        "[x1][v2]xfade=transition=fade:duration=0.4:offset=15.2[x2]",
        "[x2][v3]xfade=transition=fade:duration=0.4:offset=22.8[out]",
      );
      args.push(
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[out]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        source,
      );
      await run("ffmpeg", args, { timeout: 180000, maxBuffer: 1024 * 1024 });
    }
    const file = await readFile(source);
    manifest.push({
      channel: channel.slug,
      slug: video.slug,
      title: video.title,
      source,
      bytes: file.length,
      sha256: createHash("sha256").update(file).digest("hex"),
      thumbnail: join(folder, "thumbnail.png"),
      banner: join(directory, "banner.png"),
      description:
        video.chapters
          .map(
            (part, i) =>
              `${String(i * 8).padStart(2, "0")}s — ${part[0]}\n${part[1]} ${part[2]}`,
          )
          .join("\n\n") +
        "\n\nAn original, silent PeerScreen visual explainer. This is an editorial showcase account, not a customer identity. Artwork and video are generated from the open project source.",
      tags: [video.tag, "visual-notes", "showcase"],
    });
    console.log(
      `Prepared ${channel.title}: ${video.title} (${file.length} bytes).`,
    );
  }
}
await writeFile(
  join(root, "manifest.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      originalContent: true,
      series: series.length,
      videos: manifest,
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
