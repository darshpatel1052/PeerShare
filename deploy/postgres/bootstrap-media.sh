#!/bin/sh
set -eu
# Works for both a fresh database and the existing persistent local volume.
# psql variables avoid placing the generated password in a shell command or logs.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 --set media_password="$MEDIA_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE peerscreen_media LOGIN PASSWORD %L', :'media_password')
WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='peerscreen_media') \gexec
CREATE SCHEMA IF NOT EXISTS media AUTHORIZATION peerscreen_media;
GRANT CONNECT ON DATABASE peerscreen TO peerscreen_media;
REVOKE ALL ON SCHEMA catalog FROM peerscreen_media;
REVOKE ALL ON SCHEMA media FROM peerscreen_catalog;
SQL
