#!/usr/bin/env python3
"""Roll out an already-published commit. Database/data volumes are retained."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path('/srv/peerscreen')


def rollout(sha):
    if os.geteuid() != 0 or not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise RuntimeError('Use the administrator and a full published commit SHA')
    directory = ROOT / 'releases' / sha
    if not (directory / 'deploy/compose/production.yml').is_file():
        raise RuntimeError('The exact release source must be staged first')
    settings = json.loads((ROOT / 'host.json').read_text())
    log_path = ROOT / 'operations.log'
    descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(descriptor, 'a') as log:
        def run(args, **kwargs):
            subprocess.run(args, cwd=directory, stdout=log, stderr=log, check=True,
                           timeout=kwargs.pop('timeout', 240), **kwargs)

        login = subprocess.run(['/usr/local/bin/aws', 'ecr', 'get-login-password',
                                '--region', settings['region']], capture_output=True,
                               check=True, timeout=45)
        registry = settings['repositories']['api'].split('/')[0]
        run(['docker', 'login', '--username', 'AWS', '--password-stdin', registry],
            input=login.stdout)
        release = ROOT / 'release.env'
        old = release.read_text() if release.exists() else None
        contents = '\n'.join(['API_IMAGE=' + settings['repositories']['api'] + ':' + sha,
                              'WEB_IMAGE=' + settings['repositories']['web'] + ':' + sha]) + '\n'
        temporary = ROOT / 'release.env.new'
        temporary.write_text(contents)
        os.chmod(temporary, 0o600)
        os.replace(temporary, release)
        if old:
            previous = ROOT / 'previous-release.env'
            previous.write_text(old)
            os.chmod(previous, 0o600)
        command = ['docker', 'compose', '-p', 'peerscreen',
                   '--env-file', str(ROOT / 'runtime.env'), '--env-file', str(release),
                   '-f', 'deploy/compose/local.yml', '-f', 'deploy/compose/gateway.yml',
                   '-f', 'deploy/compose/production.yml', '--profile', 'app']
        run(command + ['pull', 'api', 'web'], timeout=600)
        run(command + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '120',
                       'postgres', 'redis', 'redis-cache', 'kafka'])
        # This one-host showcase accepts a brief maintenance window. Stop the
        # writers before migrations; keep their database and file volumes.
        run(command + ['stop', 'api', 'worker', 'media', 'web', 'gateway'])
        for service in ('media-bootstrap', 'kafka-topics', 'migrate', 'media-migrate'):
            run(command + ['run', '--rm', '--no-deps', service])
        # Change the source pointer only after migrations/setup succeed.
        pointer = ROOT / 'current.new'
        pointer.unlink(missing_ok=True)
        pointer.symlink_to(directory, target_is_directory=True)
        os.replace(pointer, ROOT / 'current')
        run(command + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '180',
                       'api', 'media', 'worker', 'web', 'gateway'])
        # Envoy reads its route configuration at process startup. A delivery
        # mode change must replace it even if its image/mounts are unchanged.
        run(command + ['up', '-d', '--no-build', '--no-deps', '--force-recreate', 'gateway'])
    print('Host services are healthy on release ' + sha + '.')


if __name__ == '__main__':
    try:
        rollout(sys.argv[1])
    except Exception:
        raise SystemExit('Release did not finish. Inspect the private host operation log before switching CloudFront.')
