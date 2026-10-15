import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("domain transition preserves credential values and updates only public runtime origins", async () => {
  const directory = await mkdtemp(join(tmpdir(), "peershare-domain-"));
  const file = join(directory, "runtime.env");
  const before =
    "# Private settings\nGOOGLE_CLIENT_SECRET=literal-value=with-escapes\\nretained\nDATABASE_URL=postgres://example.test/private\nPEERSCREEN_GATEWAY_ORIGIN=https://old.example.test\nPEERSCREEN_GATEWAY_WS_ORIGIN=wss://old.example.test\nUNRELATED_SETTING=keep-this\n";
  try {
    await writeFile(file, before, { mode: 0o600 });
    await promisify(execFile)("python3", [
      "-c",
      `import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('release',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.update_public_origins(Path(sys.argv[2]),'new.example.test')`,
      resolve("deploy/host/release.py"),
      file,
    ]);
    const after = await readFile(file, "utf8");
    assert.equal(
      after,
      before
        .replace("https://old.example.test", "https://new.example.test")
        .replace("wss://old.example.test", "wss://new.example.test"),
    );
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
