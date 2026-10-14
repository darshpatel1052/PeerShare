#!/usr/bin/env python3
"""Root-owned broker: EC2 host role -> isolated, expiring service roles.

Never prints AWS credential responses. Each container mounts only its own
directory, read-only, and cannot use IMDS (hop limit 1 + SDK disable).
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path('/srv/peerscreen')


def atomic_file(path, content, uid):
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        os.fchown(fd, uid, uid)
        with os.fdopen(fd, 'w') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Role refresh requires the host administrator')
    settings = json.loads((ROOT / 'host.json').read_text())
    environment = dict(os.environ, AWS_REGION=settings['region'], AWS_PAGER='',
                       AWS_CONFIG_FILE='/dev/null', AWS_SHARED_CREDENTIALS_FILE='/dev/null')
    for key in ('AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_EC2_METADATA_DISABLED'):
        environment.pop(key, None)
    for name in ('catalogue', 'coordinator', 'worker', 'backup'):
        result = subprocess.run(['/usr/local/bin/aws', 'sts', 'assume-role',
                                 '--role-arn', settings['roles'][name],
                                 '--role-session-name', 'peerscreen-' + name,
                                 '--duration-seconds', '3600', '--output', 'json'],
                                env=environment, capture_output=True, timeout=45)
        if result.returncode:
            raise RuntimeError('Unable to refresh the ' + name + ' role')
        credentials = json.loads(result.stdout)['Credentials']
        credentials['Version'] = 1
        uid = 0 if name == 'backup' else 10001
        directory = ROOT / 'roles' / name
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(directory, 0o700)
        os.chown(directory, uid, uid)
        atomic_file(directory / 'credentials.json', json.dumps(credentials) + '\n', uid)
        process = ('/usr/bin/python3 /srv/peerscreen/current/deploy/host/role-credentials.py backup'
                   if name == 'backup' else '/peerscreen runtime-credentials')
        atomic_file(directory / 'config', '[default]\nregion = ' + settings['region']
                    + '\ncredential_process = ' + process + '\n', uid)
    print('Refreshed four isolated runtime roles.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # A credential response must never be interpolated into a journal line.
        raise SystemExit('Runtime role refresh failed; inspect role permissions and host readiness.')
