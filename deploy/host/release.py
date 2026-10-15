#!/usr/bin/env python3
"""Roll out an already-published commit. Database/data volumes are retained."""
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys

ROOT = Path('/srv/peerscreen')


def prepare_operations(directory, root=ROOT):
    """Keep the cloud Grafana credential across releases and label its dashboard."""
    settings = root / 'operations.env'
    try:
        descriptor = os.open(settings, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(descriptor, 'w') as stream:
            stream.write('GRAFANA_ADMIN_PASSWORD=' + secrets.token_hex(24) + '\n')
    mode = settings.lstat().st_mode
    if not stat.S_ISREG(mode) or mode & 0o077:
        raise RuntimeError('Cloud monitoring settings must be a private regular file')
    if not re.fullmatch(r'GRAFANA_ADMIN_PASSWORD=[a-f0-9]{48}\n?', settings.read_text()):
        raise RuntimeError('Invalid cloud monitoring settings')
    dashboards = root / 'operations' / 'grafana' / 'dashboards'
    dashboards.mkdir(parents=True, exist_ok=True)
    dashboard = json.loads((directory / 'deploy/operations/grafana/dashboards/peerscreen.json').read_text())
    dashboard.update(title='PeerShare · AWS EC2', tags=['peershare', 'aws', 'production'],
                     description='Live metrics from the deployed AWS services, accessed through the private SSH tunnel.')
    destination = dashboards / 'peerscreen.json'
    destination.write_text(json.dumps(dashboard, indent=2) + '\n')
    os.chmod(destination, 0o644)
    return settings


def production_compose_command(release, operations, root=ROOT):
    return ['docker', 'compose', '-p', 'peerscreen',
            '--env-file', str(root / 'runtime.env'), '--env-file', str(release),
            '--env-file', str(operations),
            '-f', 'deploy/compose/local.yml', '-f', 'deploy/compose/gateway.yml',
            '-f', 'deploy/compose/production.yml', '-f', 'deploy/compose/operations.yml',
            '-f', 'deploy/compose/operations-network.yml',
            '-f', 'deploy/compose/operations-production.yml',
            '--profile', 'app', '--profile', 'ops']


def update_public_origins(runtime, domain):
    # Domain is public configuration, not a credential. Keep both public
    # origins consistent with host.json while retaining every secret value.
    origins = {'PEERSCREEN_GATEWAY_ORIGIN': 'https://' + domain,
               'PEERSCREEN_GATEWAY_WS_ORIGIN': 'wss://' + domain}
    lines = runtime.read_text().splitlines()
    seen = set()
    updated = []
    for line in lines:
        key = line.partition('=')[0]
        if key in origins:
            updated.append(key + '=' + origins[key])
            seen.add(key)
        else:
            updated.append(line)
    updated.extend(key + '=' + value for key, value in origins.items() if key not in seen)
    staged_runtime = runtime.with_name(runtime.name + '.new')
    staged_runtime.write_text('\n'.join(updated) + '\n')
    os.chmod(staged_runtime, 0o600)
    os.replace(staged_runtime, runtime)

def rollout(sha):
    if os.geteuid() != 0 or not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise RuntimeError('Use the administrator and a full published commit SHA')
    directory = ROOT / 'releases' / sha
    if not (directory / 'deploy/compose/production.yml').is_file():
        raise RuntimeError('The exact release source must be staged first')
    settings = json.loads((ROOT / 'host.json').read_text())
    operations = prepare_operations(directory)
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
        command = production_compose_command(release, operations)
        run(command + ['pull', 'api', 'web'], timeout=600)
        previous_web = subprocess.run(['docker', 'inspect', '-f', '{{.Config.Image}}', 'peerscreen-web-1'], capture_output=True, text=True, timeout=15)
        if previous_web.returncode == 0 and previous_web.stdout.strip().startswith(settings['repositories']['web'] + ':'):
            run(['python3', str(directory / 'deploy/host/retain-assets.py'), previous_web.stdout.strip()])
        run(['python3', str(directory / 'deploy/host/retain-assets.py'), settings['repositories']['web'] + ':' + sha])
        update_public_origins(ROOT / 'runtime.env', settings['domain'])
        run(command + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '120',
                       'postgres', 'redis', 'redis-cache', 'kafka'])
        run(command + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '120',
                       'prometheus', 'grafana', 'jaeger'])
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
