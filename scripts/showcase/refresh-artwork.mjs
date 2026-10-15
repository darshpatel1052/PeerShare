import { readFile, writeFile } from "node:fs/promises";
import { series } from "./catalogue.mjs";
const base = process.argv[2] || "http://localhost:3000";
if (
  ![
    "http://localhost:3000",
    "https://peerscreen.darshpatel.dev",
    "https://peershare.darshpatel.dev",
  ].includes(base)
)
  throw Error("Use a configured PeerShare application");
const local = base.startsWith("http://localhost"),
  kind = local ? "local" : "public";
const members = JSON.parse(
  await readFile(`.local/showcase/${kind}/sessions.json`, "utf8"),
);
const published = JSON.parse(
  await readFile(`.local/showcase/${kind}/published.json`, "utf8"),
);
const manifest = JSON.parse(
  await readFile(".local/showcase/manifest.json", "utf8"),
);
const record = {
  checkedAt: new Date().toISOString(),
  base,
  channels: 0,
  thumbnails: 0,
  originalUserContentModified: false,
};
async function call(member, path, method = "GET", body, headers = {}) {
  const r = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      Cookie: `${local ? "peerscreen_session" : "__Host-peerscreen_session"}=${member.token}`,
      Origin: base,
      ...headers,
    },
    body,
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  const value = text ? JSON.parse(text) : null;
  if (!r.ok) throw Error(`Artwork refresh ${method} ${r.status}`);
  return value;
}
for (const channel of series) {
  const member = members.find((m) => m.slug === channel.slug);
  if (!member) throw Error("Missing known showcase member");
  let owned = (await call(member, "/me")).channel;
  if (!owned || owned.handle !== channel.slug)
    throw Error("Showcase ownership changed");
  owned = await call(
    member,
    `/channels/${owned.id}`,
    "PATCH",
    JSON.stringify({
      title: owned.title,
      description: channel.description,
      revision: owned.revision,
    }),
    { "Content-Type": "application/json" },
  );
  await call(
    member,
    `/channels/${owned.id}/banner`,
    "PUT",
    await readFile(
      manifest.videos.find((v) => v.channel === channel.slug).banner,
    ),
    { "Content-Type": "image/png", "If-Match": String(owned.revision) },
  );
  record.channels++;
  const uploads = (await call(member, "/uploads?state=published&limit=50"))
    .items;
  for (const video of channel.videos) {
    const known = published.videos.find(
        (v) => v.slug === video.slug && v.channelID === owned.id,
      ),
      asset = manifest.videos.find(
        (v) => v.slug === video.slug && v.channel === channel.slug,
      );
    if (!known || !asset) throw Error("Unknown showcase video");
    const detail = uploads.find((item) => item.video_id === known.videoID);
    if (!detail) throw Error("Known published showcase upload is missing");
    await call(
      member,
      `/videos/${known.videoID}`,
      "PATCH",
      JSON.stringify({
        title: detail.title,
        description: asset.description,
        tags: asset.tags,
        revision: detail.revision,
      }),
      { "Content-Type": "application/json" },
    );
    const current = await call(member, `/uploads/${detail.id}`);
    await call(
      member,
      `/videos/${known.videoID}/thumbnail`,
      "PUT",
      await readFile(asset.thumbnail),
      { "Content-Type": "image/png", "If-Match": String(current.revision) },
    );
    record.thumbnails++;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}
await writeFile(
  `.local/showcase/${kind}/artwork-refresh.json`,
  JSON.stringify(record, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(record));
