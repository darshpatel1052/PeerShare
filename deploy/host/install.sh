#!/bin/bash
set -euo pipefail
test "$(id -u)" = 0
cd /srv/peerscreen/current

# Pinned official CLI with AWS's signature, checked in a separate keyring.
if ! /usr/local/bin/aws --version 2>/dev/null | grep -q 'aws-cli/2.38.0 '; then
  task_tmp=$(mktemp -d)
  trap 'rm -rf "$task_tmp"' EXIT
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64-2.38.0.zip -o "$task_tmp/aws.zip"
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64-2.38.0.zip.sig -o "$task_tmp/aws.zip.sig"
  mkdir -m 700 "$task_tmp/gpg"
  gpg --homedir "$task_tmp/gpg" --batch --import deploy/host/aws-cli-signing-key.asc
  gpg --homedir "$task_tmp/gpg" --batch --verify "$task_tmp/aws.zip.sig" "$task_tmp/aws.zip"
  unzip -q "$task_tmp/aws.zip" -d "$task_tmp"
  "$task_tmp/aws/install" --update --install-dir /usr/local/aws-cli --bin-dir /usr/local/bin
fi
mkdir -p /srv/peerscreen/roles
chmod 755 /srv/peerscreen/roles
cat >/etc/systemd/system/peerscreen-roles.service <<'UNIT'
[Unit]
Description=Refresh isolated PeerShare AWS runtime roles
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /srv/peerscreen/current/deploy/host/refresh-roles.py
UMask=0077
UNIT
cat >/etc/systemd/system/peerscreen-roles.timer <<'UNIT'
[Unit]
Description=Refresh PeerShare credentials before their one-hour expiry
[Timer]
OnBootSec=30s
OnUnitActiveSec=15min
Unit=peerscreen-roles.service
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl start peerscreen-roles.service
systemctl enable --now peerscreen-roles.timer
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
install -m 700 deploy/host/renew-certificate.sh /etc/letsencrypt/renewal-hooks/deploy/peerscreen
systemctl enable --now certbot.timer
