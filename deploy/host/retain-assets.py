#!/usr/bin/env python3
"""Keep the five latest releases' immutable chunks for tabs open during updates."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


def retain(source, root, release):
    assets = root / '_next'
    manifests = root / 'releases'
    manifests.mkdir(parents=True, exist_ok=True)
    paths = []
    for source_file in sorted(source.rglob('*')):
        if not source_file.is_file():
            continue
        relative = Path('static') / source_file.relative_to(source)
        paths.append(relative.as_posix())
        target = assets / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(source_file.read_bytes()).digest():
                raise RuntimeError('An immutable asset path changed contents')
        else:
            temporary = target.with_name(target.name + '.new')
            shutil.copyfile(source_file, temporary)
            temporary.chmod(0o644)
            os.replace(temporary, target)
    (manifests / (release + '.json')).write_text(json.dumps(paths))
    releases = sorted(manifests.glob('*.json'), key=lambda path: path.stat().st_mtime_ns, reverse=True)
    kept = set()
    for manifest in releases[:5]:
        kept.update(json.loads(manifest.read_text()))
    for asset in (assets / 'static').rglob('*'):
        if asset.is_file() and asset.relative_to(assets).as_posix() not in kept:
            asset.unlink()
    for manifest in releases[5:]:
        manifest.unlink()


if __name__ == '__main__':
    image = sys.argv[1]
    release = image.rsplit(':', 1)[-1]
    if os.geteuid() != 0 or not re.fullmatch(r'[a-f0-9]{40}', release):
        raise SystemExit('Use an administrator and an immutable published image')
    container = subprocess.check_output(['docker', 'create', image], text=True, timeout=30).strip()
    try:
        with tempfile.TemporaryDirectory(prefix='peerscreen-assets-') as temporary:
            source = Path(temporary)
            subprocess.run(['docker', 'cp', container + ':/app/apps/web/out/_next/static/.', str(source)], check=True, timeout=60)
            retain(source, Path('/srv/peerscreen/assets'), release)
    finally:
        subprocess.run(['docker', 'rm', container], check=True, timeout=30, stdout=subprocess.DEVNULL)
