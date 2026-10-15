import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const run = promisify(execFile);
export const k6Version = "1.8.2";
export const k6Binary = resolve(
  `.local/tools/k6/k6-v${k6Version}-linux-amd64/k6`,
);
export async function ensureK6() {
  try {
    await access(k6Binary);
    return k6Binary;
  } catch {}
  if (process.platform !== "linux" || process.arch !== "x64")
    throw Error("This pinned benchmark tool installation supports Linux amd64");
  const directory = resolve(".local/tools/k6");
  await mkdir(directory, { recursive: true });
  const archive = resolve(directory, "release.tgz");
  await run(
    "curl",
    [
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      `https://github.com/grafana/k6/releases/download/v${k6Version}/k6-v${k6Version}-linux-amd64.tar.gz`,
      "-o",
      archive,
    ],
    { timeout: 120000 },
  );
  if (
    createHash("sha256")
      .update(await readFile(archive))
      .digest("hex") !==
    "37620781d35406ebf402397a6c5cf4adb62d175cb052ff45325ae0b860527063"
  )
    throw Error("Official k6 archive checksum mismatch");
  await run("tar", ["-xzf", archive, "-C", directory]);
  return k6Binary;
}
