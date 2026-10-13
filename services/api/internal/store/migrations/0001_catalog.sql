CREATE TABLE catalog.users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
    password_hash text NOT NULL,
    role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'operator', 'system')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog.sessions (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id uuid NOT NULL REFERENCES catalog.users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
    revoked_at timestamptz
);
CREATE INDEX sessions_user_id_idx ON catalog.sessions(user_id);
CREATE INDEX sessions_expiry_idx ON catalog.sessions(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE catalog.channels (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL UNIQUE REFERENCES catalog.users(id),
    handle text NOT NULL UNIQUE CHECK (handle ~ '^[a-z][a-z0-9-]{1,28}[a-z0-9]$'),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog.videos (
    id uuid PRIMARY KEY,
    channel_id uuid NOT NULL REFERENCES catalog.channels(id),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
    tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 10),
    source_kind text NOT NULL CHECK (source_kind IN ('fixture', 'upload')),
    processing_state text NOT NULL DEFAULT 'pending' CHECK (processing_state IN ('pending', 'processing', 'ready', 'failed', 'cancelled')),
    publication_state text NOT NULL DEFAULT 'draft' CHECK (publication_state IN ('draft', 'published', 'unpublished')),
    duration_seconds integer CHECK (duration_seconds BETWEEN 1 AND 600),
    accepted_generation_id uuid,
    accepted_attempt_id uuid,
    manifest_key text,
    integrity_key text,
    thumbnail_key text,
    qualities integer[],
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    deleted_at timestamptz,
    CHECK (publication_state <> 'published' OR (
        processing_state = 'ready' AND duration_seconds IS NOT NULL
        AND accepted_generation_id IS NOT NULL AND accepted_attempt_id IS NOT NULL
        AND manifest_key IS NOT NULL AND integrity_key IS NOT NULL AND thumbnail_key IS NOT NULL
        AND qualities IS NOT NULL AND cardinality(qualities) > 0 AND published_at IS NOT NULL
    ))
);
CREATE INDEX videos_public_feed_idx ON catalog.videos(published_at DESC, id DESC)
    WHERE publication_state = 'published' AND deleted_at IS NULL;
CREATE INDEX videos_channel_feed_idx ON catalog.videos(channel_id, published_at DESC, id DESC)
    WHERE publication_state = 'published' AND deleted_at IS NULL;
