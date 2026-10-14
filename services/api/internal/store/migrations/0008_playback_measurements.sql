CREATE TABLE catalog.playback_sessions (
    id uuid PRIMARY KEY,
    video_id uuid NOT NULL REFERENCES catalog.videos(id) ON DELETE CASCADE,
    generation_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    token_hash bytea NOT NULL CHECK(octet_length(token_hash)=32),
    measurement_mode text NOT NULL CHECK(measurement_mode IN('verified_hls','native_hls')),
    last_sequence integer NOT NULL DEFAULT 0 CHECK(last_sequence BETWEEN 0 AND 720),
    latest_metrics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(octet_length(latest_metrics::text)<=4096),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now()+interval '2 hours'
);
CREATE INDEX playback_sessions_video_idx ON catalog.playback_sessions(video_id,created_at);
CREATE INDEX playback_sessions_retention_idx ON catalog.playback_sessions(created_at);
CREATE TABLE catalog.playback_capacity (
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    batches integer NOT NULL DEFAULT 0 CHECK(batches BETWEEN 0 AND 200000)
);
INSERT INTO catalog.playback_capacity(singleton) VALUES(true);
CREATE TABLE catalog.telemetry_batches (
    session_id uuid NOT NULL REFERENCES catalog.playback_sessions(id) ON DELETE CASCADE,
    sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 720),
    request_hash bytea NOT NULL CHECK(octet_length(request_hash)=32),
    event_id uuid NOT NULL UNIQUE,
    accepted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(session_id,sequence)
);
CREATE TABLE catalog.playback_outbox (
    event_id uuid PRIMARY KEY REFERENCES catalog.telemetry_batches(event_id) ON DELETE CASCADE,
    video_id uuid NOT NULL,
    payload bytea NOT NULL CHECK(octet_length(payload)<=4096),
    published_at timestamptz,
    failures integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX playback_outbox_pending_idx ON catalog.playback_outbox(next_attempt_at,created_at) WHERE published_at IS NULL;
