import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
const run = promisify(execFile);
export const versions = {
  kind: "0.33.0",
  helm: "4.3.0",
  kubectl: "1.37.1",
  node: "kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5",
};
const directory = resolve(".local/tools/kubernetes");
export const binaries = Object.fromEntries(
  ["kind", "helm", "kubectl"].map((name) => [name, resolve(directory, name)]),
);
async function download(name, url, hash) {
  const path = resolve(directory, name);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== hash) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok)
      throw new Error(`Official ${name} download failed (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== hash)
      throw new Error(`${name} checksum mismatch`);
    await writeFile(path, bytes, { mode: 0o700 });
  }
  return path;
}
export async function ensureKubernetesTools() {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error(
      "This pinned tool helper supports Linux amd64; use release-matched tools on another host",
    );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await download(
    "kind",
    "https://github.com/kubernetes-sigs/kind/releases/download/v0.33.0/kind-linux-amd64",
    "aee6151561422756b764a4ae28e7f44cda5af5a9eead3cc9985112b1de8d8e0d",
  );
  await chmod(binaries.kind, 0o700);
  await download(
    "kubectl",
    "https://dl.k8s.io/release/v1.37.1/bin/linux/amd64/kubectl",
    "65691ff77eb6fa44c908b77a1082c9f092c3b9733b5cefabec0d1104890e21a8",
  );
  await chmod(binaries.kubectl, 0o700);
  const archive = await download(
    "helm.tar.gz",
    "https://get.helm.sh/helm-v4.3.0-linux-amd64.tar.gz",
    "86584a54def73570558f66f5111cc53dfed56689637ae32c1201205d494f54fb",
  );
  await run("tar", ["-xzf", archive, "-C", directory, "linux-amd64/helm"]);
  const helm = await readFile(resolve(directory, "linux-amd64/helm"));
  await writeFile(binaries.helm, helm, { mode: 0o700 });
  return binaries;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  await ensureKubernetesTools();
  console.log(
    "Pinned and checksum-verified local kind, Helm and kubectl are ready.",
  );
}
