import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticServer } from "../../scripts/static-server.mjs";

test("a tab from the previous release can still load its lazy chunk without exposing retained private files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "peerscreen-assets-"));
  const webRoot = join(directory, "web"),
    retainedAssetsRoot = join(directory, "retained");
  await mkdir(join(webRoot, "_next/static"), { recursive: true });
  await mkdir(join(retainedAssetsRoot, "static"), { recursive: true });
  await writeFile(join(webRoot, "_next/static/current.js"), "current-chunk");
  await writeFile(
    join(retainedAssetsRoot, "static/previous-hash.js"),
    "previous-lazy-peer-chunk",
  );
  await writeFile(join(retainedAssetsRoot, "private.json"), "not-public");
  const server = createStaticServer({
    webRoot,
    mediaRoot: directory,
    retainedAssetsRoot,
  });
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const previous = await fetch(base + "/_next/static/previous-hash.js");
    assert.equal(previous.status, 200);
    assert.equal(await previous.text(), "previous-lazy-peer-chunk");
    assert.match(previous.headers.get("cache-control")!, /immutable/);
    assert.equal(
      await (await fetch(base + "/_next/static/current.js")).text(),
      "current-chunk",
    );
    for (const path of [
      "/_next/private.json",
      "/media/private.json",
      "/_next/static/missing.js",
    ])
      assert.equal((await fetch(base + path)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((accept) => server.close(() => accept()));
    await rm(directory, { recursive: true, force: true });
  }
});
