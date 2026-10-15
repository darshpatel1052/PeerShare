import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("cloud releases retain private Grafana credentials and mark the live AWS dashboard", async () => {
  const root = await mkdtemp(join(tmpdir(), "peershare-cloud-operations-"));
  try {
    await promisify(execFile)("python3", [
      "-c",
      `
import importlib.util,json,os,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('release',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
source=Path(sys.argv[2]);root=Path(sys.argv[3])
file=module.prepare_operations(source,root)
credential=file.read_bytes()
assert file.stat().st_mode & 0o777 == 0o600
module.prepare_operations(source,root)
assert file.read_bytes() == credential, 'release replaced the retained credential'
dashboard=json.loads((root/'operations/grafana/dashboards/peerscreen.json').read_text())
assert dashboard['title']=='PeerShare · AWS EC2'
assert dashboard['uid']=='peerscreen-operations'
assert len(dashboard['panels'])==8
assert 'aws' in dashboard['tags']
args=module.production_compose_command(root/'release.env',file,root)
assert str(file) in args
assert 'ops' in args
assert 'deploy/compose/operations-production.yml' in args
os.chmod(file,0o644)
try: module.prepare_operations(source,root)
except RuntimeError: pass
else: raise AssertionError('publicly readable monitoring credential accepted')
os.chmod(file,0o600)
file.write_text('GRAFANA_ADMIN_PASSWORD=broken\\n')
try: module.prepare_operations(source,root)
except RuntimeError: pass
else: raise AssertionError('invalid monitoring credential accepted')
assert file.read_text()=='GRAFANA_ADMIN_PASSWORD=broken\\n', 'invalid configuration silently overwritten'
`,
      resolve("deploy/host/release.py"),
      process.cwd(),
      root,
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
