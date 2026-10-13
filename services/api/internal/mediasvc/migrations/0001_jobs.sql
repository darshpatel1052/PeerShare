CREATE TABLE IF NOT EXISTS media.schema_migrations (
 version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE media.jobs (
 id uuid PRIMARY KEY,
 video_id uuid NOT NULL,
 generation_id uuid NOT NULL,
 input_hash bytea NOT NULL CHECK(octet_length(input_hash)=32),
 snapshot bytea NOT NULL CHECK(octet_length(snapshot)<=1048576),
 state text NOT NULL CHECK(state IN ('queued','running','retry_wait','ready','failed','cancel_requested','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 version bigint NOT NULL CHECK(version>0),
 lease_expires_at timestamptz,
 next_retry_at timestamptz,
 last_dispatch_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(video_id,generation_id)
);
CREATE INDEX media_jobs_lease_idx ON media.jobs(lease_expires_at) WHERE state='running';
CREATE INDEX media_jobs_retry_idx ON media.jobs(next_retry_at) WHERE state='retry_wait';
CREATE TABLE media.claim_requests (
 request_id uuid PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES media.jobs(id),
 worker_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 epoch bigint NOT NULL CHECK(epoch>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(job_id,epoch)
);
CREATE TABLE media.outbox (
 id uuid PRIMARY KEY,
 topic text NOT NULL,
 aggregate_id uuid NOT NULL,
 payload bytea NOT NULL CHECK(octet_length(payload)<=2097152),
 published_at timestamptz,
 failures integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_outbox_pending_idx ON media.outbox(next_attempt_at,created_at) WHERE published_at IS NULL;
CREATE TABLE media.command_inbox (
 request_id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES media.jobs(id), action text NOT NULL CHECK(action IN('retry','cancel'))
);
CREATE TABLE media.quarantine (
 topic text NOT NULL, partition_id integer NOT NULL, record_offset bigint NOT NULL,
 content_sha256 bytea NOT NULL CHECK(octet_length(content_sha256)=32), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(topic,partition_id,record_offset)
);
