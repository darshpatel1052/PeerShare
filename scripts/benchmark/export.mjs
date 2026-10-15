import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
  access,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve("docs/evidence/phase-6/benchmark"),
  raw = join(root, "raw");
await mkdir(raw, { recursive: true });
const allowed = new Set([
  "campaign.json",
  "summary.json",
  "generator.json",
  "server-counters.json",
  "resources.jsonl",
  "pipeline.json",
  "measured-source.mjs",
  "output-verification.json",
  "peer-comparison.json",
  "peer-watch.png",
]);
async function tree(from, to, plans = false) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory())
      await tree(join(from, entry.name), join(to, entry.name), plans);
    else if (
      allowed.has(entry.name) ||
      (plans && entry.name.endsWith(".json")) ||
      /^round-\d+-(http-only|peer-assisted)-counters\.json$/.test(entry.name)
    )
      await copyFile(join(from, entry.name), join(to, entry.name));
  }
}
for (const label of ["baseline-v1", "optimized-v1"])
  await tree(resolve(".local/benchmark/runs", label), join(raw, label));
for (const label of [
  "pipeline-v1",
  "private-segments-v1",
  "public-segments-before",
  "public-segments-after",
  "public-peers-v1",
]) {
  try {
    await access(resolve(".local/benchmark/media", label));
    await tree(resolve(".local/benchmark/media", label), join(raw, label));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
for (const label of ["before-index", "before-index-bounded", "after-index"])
  await tree(
    resolve(".local/benchmark/plans", label),
    join(raw, "plans", label),
    true,
  );
for (const [from, to] of [
  [".local/benchmark/stopped.json", "catalogue-processes-stopped.json"],
  [
    ".local/evidence/public-release-preservation.json",
    "public-release-preservation.json",
  ],
]) {
  try {
    await copyFile(from, join(raw, to));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const secrets = JSON.parse(
  await readFile(".local/benchmark/users.json", "utf8"),
)
  .map((u) => u.token)
  .concat(
    JSON.parse(
      await readFile(".local/showcase/public/sessions.json", "utf8"),
    ).map((u) => u.token),
    [(await readFile(".local/benchmark/db-password", "utf8")).trim()],
  );
const files = [];
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await scan(p);
    else {
      const data = await readFile(p);
      if (entry.name.endsWith(".json") || entry.name.endsWith(".jsonl")) {
        const text = data.toString();
        if (
          secrets.some((s) => s && text.includes(s)) ||
          /"Cookie"\s*:|postgres:\/\//.test(text)
        )
          throw Error("Refusing to export private credentials");
      }
      files.push({
        path: p.slice(root.length + 1),
        bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
    }
  }
}
await scan(raw);
await writeFile(
  join(root, "manifest.json"),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      scope:
        "Allowlisted raw measurements only; no credential/session/fixture files; SHA-256 fingerprints of delivered raw artifacts",
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    archivedFiles: files.length,
    bytes: files.reduce((n, f) => n + f.bytes, 0),
  }),
);
