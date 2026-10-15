#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 --set catalog_password="$CATALOG_DB_PASSWORD" <<'SQL'
CREATE ROLE peerscreen_catalog LOGIN PASSWORD :'catalog_password';
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA catalog AUTHORIZATION peerscreen_catalog;
REVOKE CONNECT ON DATABASE peerscreen FROM PUBLIC;
GRANT CONNECT ON DATABASE peerscreen TO peerscreen_catalog;
SQL
