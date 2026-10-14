#!/usr/bin/env python3
"""Read-only origin checks through loopback TLS, without exposing its secret."""
from datetime import datetime, timezone
import hashlib
import http.client
import json
from pathlib import Path
import socket
import ssl
import subprocess

ROOT = Path('/srv/peerscreen')
settings = json.loads((ROOT / 'host.json').read_text())
gateway = json.loads((ROOT / 'gateway/envoy.json').read_text())
routes = gateway['static_resources']['listeners'][0]['filter_chains'][0]['filters'][0]['typed_config']['route_config']['virtual_hosts'][0]['routes']
secret = next(header['string_match']['exact'] for route in routes
              for header in route['match'].get('headers', [])
              if header['name'] == 'x-peerscreen-origin')


class OriginConnection(http.client.HTTPSConnection):
    def connect(self):
        self.sock = self._context.wrap_socket(socket.create_connection(('127.0.0.1', 443), timeout=15),
                                             server_hostname=settings['origin'])


def get(path, authenticated=True):
    connection = OriginConnection(settings['origin'], context=ssl.create_default_context(), timeout=15)
    headers = {'Host': settings['origin']}
    if authenticated:
        headers.update({'X-PeerScreen-Origin': secret, 'CloudFront-Viewer-Address': '198.51.100.7:43210'})
    connection.request('GET', path, headers=headers)
    response = connection.getresponse()
    body = response.read()
    status = response.status
    connection.close()
    return status, body


try:
    assert get('/health/ready')[0] == 200
    assert get('/api/v1/videos')[0] == 200
    assert get('/api/v1/videos', False)[0] == 403
    assert get('/metrics')[0] == 404
    assert get('/')[0] == 200
    assert get('/channel/')[0] == 200
    channel = 'a4f9c019-86c3-4a92-abc7-ec9ea2a1d2ad'
    video = '853f24f7-c632-4909-8e82-f0b5ba26401b'
    assert get('/api/v1/channels/' + channel)[0] == 200
    status, body = get('/api/v1/videos/' + video)
    assert status == 200
    item = json.loads(body)
    from urllib.parse import urlparse
    status, descriptor_body = get(urlparse(item['playback']['integrity_url']).path)
    assert status == 200
    status, manifest = get(urlparse(item['playback']['manifest_url']).path)
    assert status == 200 and b'#EXTM3U' in manifest
    expirations = {}
    for name in ('catalogue', 'coordinator', 'worker', 'backup'):
        path = ROOT / 'roles' / name / 'credentials.json'
        assert path.stat().st_mode & 0o777 == 0o600
        value = json.loads(path.read_text())
        expiry = datetime.fromisoformat(value['Expiration'].replace('Z', '+00:00'))
        assert expiry > datetime.now(timezone.utc)
        expirations[name] = expiry.isoformat()
    timer = subprocess.run(['systemctl', 'is-active', 'peerscreen-roles.timer'], capture_output=True, check=True).stdout.strip()
    assert timer == b'active'
    print(json.dumps({'checkedAt': datetime.now(timezone.utc).isoformat(),
                      'scope': 'Actual AWS host via loopback TLS with private origin header; public CloudFront pending',
                      'validOriginTLS': True, 'healthReady': True, 'staticRoutes': True,
                      'originalChannel': True, 'originalVideo': True,
                      's3Manifest': True, 's3Integrity': True,
                      'missingOriginHeader403': True, 'metricsPrivate404': True,
                      'roleRefreshTimer': True, 'temporaryRoleExpirations': expirations,
                      'manifestSHA256': hashlib.sha256(manifest).hexdigest(),
                      'integritySHA256': hashlib.sha256(descriptor_body).hexdigest(),
                      'publicDeployment': False, 'liveGoogleAuthentication': False}))
except Exception:
    raise SystemExit('Origin verification failed; inspect service readiness and private host logs.')
