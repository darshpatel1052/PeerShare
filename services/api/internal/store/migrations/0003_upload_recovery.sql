-- Extend the existing Phase 2 migration; never rewrite an applied checksum.
ALTER TABLE catalog.videos ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE catalog.upload_sessions
    ADD COLUMN part_checksums jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(part_checksums)='array' AND jsonb_array_length(part_checksums)<=32),
    ADD COLUMN source_sha256 bytea CHECK (source_sha256 IS NULL OR octet_length(source_sha256)=32),
    ADD COLUMN reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
    ADD COLUMN parts_cleaned boolean NOT NULL DEFAULT false,
    ADD COLUMN cleanup_done boolean NOT NULL DEFAULT false;
-- Reserve both the source and multipart assembly plus a three-attempt derivative budget and staging allowance.
UPDATE catalog.upload_sessions SET reserved_bytes=expected_bytes*2+826277888
    WHERE state IN ('open','completed');

ALTER TABLE catalog.processing_jobs
    ADD COLUMN generation_id uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN attempt_id uuid,
    ADD COLUMN worker_id uuid,
    ADD COLUMN lease_expires_at timestamptz,
    ADD COLUMN output_bytes bigint CHECK (output_bytes >= 0);
CREATE INDEX processing_jobs_lease_idx ON catalog.processing_jobs(lease_expires_at) WHERE state='running';

CREATE TABLE catalog.upload_part_grants (
    upload_id uuid NOT NULL REFERENCES catalog.upload_sessions(id) ON DELETE CASCADE,
    part_number integer NOT NULL CHECK (part_number BETWEEN 1 AND 32),
    token_hash bytea NOT NULL CHECK (octet_length(token_hash)=32),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (upload_id, part_number)
);
