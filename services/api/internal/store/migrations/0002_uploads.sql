ALTER TABLE catalog.videos
    ADD COLUMN source_key text,
    ADD COLUMN source_bytes bigint CHECK (source_bytes BETWEEN 1 AND 262144000);

CREATE TABLE catalog.upload_sessions (
    id uuid PRIMARY KEY,
    video_id uuid NOT NULL UNIQUE REFERENCES catalog.videos(id) ON DELETE CASCADE,
    owner_id uuid NOT NULL REFERENCES catalog.users(id),
    idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 128),
    request_fingerprint bytea NOT NULL CHECK (octet_length(request_fingerprint)=32),
    expected_bytes bigint NOT NULL CHECK (expected_bytes BETWEEN 1 AND 262144000),
    part_bytes integer NOT NULL DEFAULT 8388608 CHECK (part_bytes=8388608),
    state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','completed','aborted','expired')),
    expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(owner_id,idempotency_key)
);
CREATE INDEX upload_sessions_open_expiry_idx ON catalog.upload_sessions(expires_at) WHERE state='open';

CREATE TABLE catalog.upload_parts (
    upload_id uuid NOT NULL REFERENCES catalog.upload_sessions(id) ON DELETE CASCADE,
    part_number integer NOT NULL CHECK (part_number BETWEEN 1 AND 32),
    byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 8388608),
    sha256 bytea NOT NULL CHECK (octet_length(sha256)=32),
    storage_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(upload_id,part_number)
);

CREATE TABLE catalog.processing_jobs (
    id uuid PRIMARY KEY,
    video_id uuid NOT NULL UNIQUE REFERENCES catalog.videos(id) ON DELETE CASCADE,
    state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','ready','failed','cancelled')),
    stage text NOT NULL DEFAULT 'queued' CHECK (stage IN ('queued','validating','encoding','thumbnail','indexing','ready','failed','cancelled')),
    progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX processing_jobs_queue_idx ON catalog.processing_jobs(created_at) WHERE state='queued';
