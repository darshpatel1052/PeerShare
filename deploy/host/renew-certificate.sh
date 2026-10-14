#!/bin/bash
set -euo pipefail
# Certbot invokes this only after a successful renewal. A directory mount makes
# atomic certificate replacements visible without stale file-bind inodes.
test -n "${RENEWED_LINEAGE:-}"
origin=$(python3 -c 'import json; print(json.load(open("/srv/peerscreen/host.json"))["origin"])')
test "$RENEWED_LINEAGE" = "/etc/letsencrypt/live/$origin"
mkdir -p /srv/peerscreen/tls
install -o 10001 -g 10001 -m 600 "$RENEWED_LINEAGE/fullchain.pem" /srv/peerscreen/tls/cert.pem.new
install -o 10001 -g 10001 -m 600 "$RENEWED_LINEAGE/privkey.pem" /srv/peerscreen/tls/key.pem.new
mv /srv/peerscreen/tls/cert.pem.new /srv/peerscreen/tls/cert.pem
mv /srv/peerscreen/tls/key.pem.new /srv/peerscreen/tls/key.pem
if [ -f /srv/peerscreen/release.env ]; then
  cd /srv/peerscreen/current
  docker compose -p peerscreen --env-file /srv/peerscreen/runtime.env --env-file /srv/peerscreen/release.env \
    -f deploy/compose/local.yml -f deploy/compose/gateway.yml -f deploy/compose/production.yml \
    --profile app up -d --no-build --no-deps --force-recreate gateway
fi
