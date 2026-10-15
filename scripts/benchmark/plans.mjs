import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { sql, privateError } from "./host.mjs";
const label = process.argv[2];
if (!/^[a-z0-9-]{1,40}$/.test(label || ""))
  throw Error("Use a unique plan evidence label");
const root = resolve(".local/benchmark/plans", label);
await mkdir(root, { recursive: true, mode: 0o700 });
const source = await readFile("services/api/internal/store/videos.go", "utf8"),
  columns = source.match(/const videoColumns = `([^`]+)`/)[1];
const visible = "v.publication_state='published' AND v.deleted_at IS NULL",
  order = " ORDER BY v.published_at DESC,v.id DESC LIMIT $1";
const baseline = `SELECT ${columns} FROM catalog.videos v JOIN catalog.channels c ON c.id=v.channel_id WHERE ${visible} AND ($1::uuid IS NULL OR v.channel_id=$1) AND ($2::timestamptz IS NULL OR (v.published_at,v.id)<($2,$3::uuid)) AND ($5 OR v.source_kind<>'fixture') AND ($6='' OR v.search_document @@ websearch_to_tsquery('pg_catalog.simple',$6) OR strpos(lower(c.title),lower($6))>0) AND ($7='' OR EXISTS(SELECT 1 FROM catalog.subscriptions sub WHERE sub.user_id=NULLIF($7,'')::uuid AND sub.channel_id=v.channel_id)) ORDER BY v.published_at DESC,v.id DESC LIMIT $4`;
const where = visible + " AND v.source_kind<>'fixture'";
const optimized = `WITH matching_channels AS MATERIALIZED (SELECT id FROM catalog.channels WHERE strpos(lower(title),lower($2::text))>0), candidates AS ((SELECT v.id,v.published_at FROM catalog.videos v WHERE ${where} AND v.search_document @@ websearch_to_tsquery('pg_catalog.simple',$2::text)${order}) UNION (SELECT per.id,per.published_at FROM matching_channels mc CROSS JOIN LATERAL (SELECT v.id,v.published_at FROM catalog.videos v WHERE v.channel_id=mc.id AND ${where}${order}) per${order.replaceAll("v.", "per.")})) SELECT ${columns} FROM candidates hit JOIN catalog.videos v ON v.id=hit.id JOIN catalog.channels c ON c.id=v.channel_id${order}`;
const scope = `SELECT c.revision::text||':'||coalesce(max(v.updated_at)::text,'empty')||':'||count(v.id)::text FROM catalog.channels c LEFT JOIN catalog.videos v ON v.channel_id=c.id WHERE c.id=$1 AND c.owner_id=$2 AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM catalog.videos x WHERE x.id=$3 AND x.channel_id=c.id AND x.deleted_at IS NULL)) GROUP BY c.id`;
const members = JSON.parse(
  await readFile(".local/benchmark/users.json", "utf8"),
);
try {
  const records = [];
  for (const [name, query, args] of [
    [
      "old-search-absent",
      baseline,
      "NULL,NULL,NULL,13,false,'missing-term-9zz',''",
    ],
    ["new-search-absent", optimized, "13,'missing-term-9zz'"],
    ["old-search-common", baseline, "NULL,NULL,NULL,13,false,'PostgreSQL',''"],
    ["new-search-common", optimized, "13,'PostgreSQL'"],
    [
      "analytics-scope",
      scope,
      `'${members[0].channelID}','${members[0].userID}',NULL`,
    ],
  ]) {
    for (const planMode of ["force_custom_plan", "force_generic_plan"]) {
      const command = `SET statement_timeout='30s'; SET default_transaction_read_only=on; SET plan_cache_mode=${planMode}; PREPARE measured AS ${query}; EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) EXECUTE measured(${args});`;
      const plan = JSON.parse(
        await sql(command, { database: "peerscreen_benchmark" }),
      );
      const record = {
        name,
        planMode,
        checkedAt: new Date().toISOString(),
        sql: query,
        arguments: args,
        plan,
      };
      await writeFile(
        join(root, name + "-" + planMode + ".json"),
        JSON.stringify(record, null, 2) + "\n",
        { mode: 0o600 },
      );
      records.push({
        name,
        planMode,
        executionMS: plan[0]["Execution Time"],
        planningMS: plan[0]["Planning Time"],
        hitBlocks: plan[0].Plan["Shared Hit Blocks"],
        readBlocks: plan[0].Plan["Shared Read Blocks"],
      });
    }
  }
  await writeFile(
    join(root, "summary.json"),
    JSON.stringify(
      {
        label,
        sourceSHA256: createHash("sha256").update(source).digest("hex"),
        records,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(records));
} catch (e) {
  await privateError("plans-error.txt", e);
}
