#!/usr/bin/env python3
"""Credential protocol for root-only backup tools; stdout is secret SDK input."""
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import sys

try:
    if os.geteuid() != 0 or sys.argv[1:] != ['backup']:
        raise ValueError()
    path = Path('/srv/peerscreen/roles/backup/credentials.json')
    if path.stat().st_mode & 0o077 or path.stat().st_size > 16384:
        raise ValueError()
    value = json.loads(path.read_text())
    expiry = datetime.fromisoformat(value['Expiration'].replace('Z', '+00:00'))
    if expiry <= datetime.now(timezone.utc) + timedelta(seconds=30):
        raise ValueError()
    print(json.dumps(value))
except Exception:
    raise SystemExit('Backup role credentials unavailable or expired.')
