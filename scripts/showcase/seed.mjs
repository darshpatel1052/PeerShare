import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { series } from "./catalogue.mjs";
import { sql, privateError } from "../benchmark/host.mjs";
import { awsRead, awsEnvironment } from "../aws-environment.mjs";
const base = process.argv[2] || "https://peerscreen.darshpatel.dev";
if (
  !["http://localhost:3000", "https://peerscreen.darshpatel.dev"].includes(base)
)
  throw Error("Use the authorized local or public deployment");
const local = base.startsWith("http:"),
  directory = resolve(".local/showcase", local ? "local" : "public");
await mkdir(directory, { recursive: true, mode: 0o700 });
export function stableID(label) {
  const b = createHash("sha256")
    .update("peerscreen-showcase-v1:" + label)
    .digest()
    .subarray(0, 16);
  b[6] = (b[6] & 15) | 0x50;
  b[8] = (b[8] & 63) | 0x80;
  const s = b.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
let members;
try {
  members = JSON.parse(
    await readFile(join(directory, "sessions.json"), "utf8"),
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  members = series.map((s) => ({
    slug: s.slug,
    id: stableID(s.slug),
    email: `showcase+${s.slug}@example.test`,
    display: s.title,
    token: randomBytes(32).toString("base64url"),
  }));
  await writeFile(
    join(directory, "sessions.json"),
    JSON.stringify(members, null, 2) + "\n",
    { mode: 0o600 },
  );
}
let evidence = {
  checkedAt: null,
  scope:
    "Original owned showcase content uploaded through the actual API pipeline",
  base,
  syntheticAccounts: true,
  realUserGrowth: false,
  videos: [],
};
try {
  evidence = JSON.parse(
    await readFile(join(directory, "published.json"), "utf8"),
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const save = async () =>
  writeFile(
    join(directory, "published.json"),
    JSON.stringify(evidence, null, 2) + "\n",
    { mode: 0o600 },
  );
async function call(member, path, { method = "GET", body, headers = {} } = {}) {
  const binary = Buffer.isBuffer(body);
  const r = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      Cookie: `${local ? "peerscreen_session" : "__Host-peerscreen_session"}=${member.token}`,
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
  const type = r.headers.get("content-type") || "";
  const value = type.includes("application/json") ? await r.json() : null;
  if (!r.ok) {
    const error = Error(
      `${method} ${path} returned ${r.status} (${value?.error?.code || "request_failed"})`,
    );
    error.status = r.status;
    throw error;
  }
  return { status: r.status, value };
}
try {
  if (!local) {
    const cfg = await awsEnvironment();
    const [id, plan] = await Promise.all([
      awsRead(["sts", "get-caller-identity"]),
      awsRead(["freetier", "get-account-plan-state"], { region: "us-east-1" }),
    ]);
    if (
      id.Account !== cfg.settings.AWS_ACCOUNT_ID ||
      plan.accountPlanType !== "FREE" ||
      plan.accountPlanStatus !== "ACTIVE" ||
      Number(plan.accountPlanRemainingCredits?.amount) < 10
    )
      throw Error("Active configured Free plan and USD 10 credits required");
  }
  const data = members.map((m) => ({
    ...m,
    hash: createHash("sha256").update(m.token).digest("hex"),
  }));
  // Only generated identities enter SQL. Raw session capabilities stay private.
  const encoded = Buffer.from(
    JSON.stringify(data.map(({ token, ...m }) => m)),
  ).toString("base64");
  await sql(
    `BEGIN;
 CREATE TEMP TABLE showcase_members AS SELECT * FROM jsonb_to_recordset(convert_from(decode('${encoded}','base64'),'UTF8')::jsonb) AS x(id uuid,email text,display text,slug text,hash text);
 DO $$ BEGIN IF EXISTS(SELECT 1 FROM catalog.users u JOIN showcase_members m ON u.id=m.id OR u.email=m.email WHERE u.id<>m.id OR u.email<>m.email) THEN RAISE EXCEPTION 'Showcase identity collision'; END IF; END $$;
 INSERT INTO catalog.users(id,email,display_name,password_hash) SELECT id,email,display,NULL FROM showcase_members ON CONFLICT(id) DO NOTHING;
 INSERT INTO catalog.sessions(token_hash,user_id,expires_at) SELECT decode(hash,'hex'),id,now()+interval '24 hours' FROM showcase_members ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at,revoked_at=NULL;
 INSERT INTO catalog.creator_access(user_id,expires_at) SELECT id,now()+interval '24 hours' FROM showcase_members ON CONFLICT(user_id) DO UPDATE SET granted_at=now(),expires_at=excluded.expires_at;
 COMMIT;`,
    { local },
  );
  const content = JSON.parse(
    await readFile(".local/showcase/manifest.json", "utf8"),
  );
  for (const channel of series) {
    const member = members.find((m) => m.slug === channel.slug);
    let me = (await call(member, "/me")).value;
    let owned = me.channel;
    if (!owned)
      owned = (
        await call(member, "/channels", {
          method: "POST",
          body: {
            handle: channel.slug,
            title: channel.title,
            description: channel.description,
          },
        })
      ).value;
    if (owned.handle !== channel.slug)
      throw Error("Showcase channel identity changed");
    if (!owned.banner_url) {
      owned = (
        await call(member, `/channels/${owned.id}/banner`, {
          method: "PUT",
          body: await readFile(
            content.videos.find((v) => v.channel === channel.slug).banner,
          ),
          headers: {
            "Content-Type": "image/png",
            "If-Match": String(owned.revision),
          },
        })
      ).value;
    }
    for (const video of content.videos.filter(
      (v) => v.channel === channel.slug,
    )) {
      const existing = evidence.videos.find((v) => v.slug === video.slug);
      if (existing?.published) {
        console.log("Retained published showcase: " + video.title);
        continue;
      }
      const payload = await readFile(video.source),
        parts = [];
      for (let offset = 0; offset < payload.length; offset += 8 * 1024 * 1024)
        parts.push(payload.subarray(offset, offset + 8 * 1024 * 1024));
      const started = Date.now();
      let upload = (
        await call(member, "/uploads", {
          method: "POST",
          body: {
            channel_id: owned.id,
            title: video.title,
            description: video.description,
            tags: video.tags,
            size: payload.length,
            part_checksums: parts.map((p) =>
              createHash("sha256").update(p).digest("hex"),
            ),
          },
          headers: { "Idempotency-Key": stableID(video.slug) },
        })
      ).value;
      if (upload.state === "open") {
        for (let offset = 0; offset < parts.length; offset += 3) {
          const numbers = parts
            .slice(offset, offset + 3)
            .map((_, i) => offset + i + 1)
            .filter((n) => !upload.parts.some((p) => p.number === n));
          if (!numbers.length) continue;
          const grants = (
            await call(member, `/uploads/${upload.id}/parts/presign`, {
              method: "POST",
              body: { numbers },
            })
          ).value.parts;
          for (let i = 0; i < numbers.length; i++)
            await call(member, `/uploads/${upload.id}/parts/${numbers[i]}`, {
              method: "PUT",
              body: parts[numbers[i] - 1],
              headers: { "Upload-Token": grants[i].token },
            });
        }
        await call(member, `/uploads/${upload.id}/complete`, {
          method: "POST",
        });
      }
      const uploadedAt = Date.now();
      let ready = false;
      while (Date.now() - started < 240000) {
        upload = (await call(member, `/uploads/${upload.id}`)).value;
        if (upload.processing_state === "ready") {
          ready = true;
          break;
        }
        if (["failed", "cancelled"].includes(upload.processing_state))
          throw Error("Showcase processing failed: " + video.slug);
        await new Promise((r) => setTimeout(r, 750));
      }
      if (!ready) throw Error("Showcase preparation deadline exceeded");
      if (!upload.has_custom_thumbnail)
        await call(member, `/videos/${upload.video_id}/thumbnail`, {
          method: "PUT",
          body: await readFile(video.thumbnail),
          headers: {
            "Content-Type": "image/png",
            "If-Match": String(upload.revision),
          },
        });
      if (upload.publication_state !== "published")
        await call(member, `/videos/${upload.video_id}/publish`, {
          method: "POST",
        });
      const published = (await call(member, `/videos/${upload.video_id}`))
        .value;
      const record = {
        slug: video.slug,
        title: video.title,
        channelID: owned.id,
        videoID: upload.video_id,
        sourceBytes: payload.length,
        sourceSHA256: video.sha256,
        durationSeconds: published.duration_seconds,
        qualities: published.qualities,
        uploadMS: uploadedAt - started,
        processingWaitMS: Date.now() - uploadedAt,
        totalMS: Date.now() - started,
        published: true,
        watchURL: base + "/watch/?v=" + upload.video_id,
      };
      const old = evidence.videos.findIndex((v) => v.slug === video.slug);
      if (old >= 0) evidence.videos[old] = record;
      else evidence.videos.push(record);
      evidence.checkedAt = new Date().toISOString();
      await save();
      console.log(
        `Published ${evidence.videos.length}/18: ${video.title} (${record.totalMS} ms).`,
      );
    }
  }
  console.log(
    "Showcase complete: " +
      evidence.videos.length +
      " actual playable uploads. Session capabilities remain private.",
  );
} catch (e) {
  await save();
  await privateError("showcase-error.txt", e);
}
