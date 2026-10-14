CREATE TABLE catalog.subscriptions (
    user_id uuid NOT NULL REFERENCES catalog.users(id) ON DELETE CASCADE,
    channel_id uuid NOT NULL REFERENCES catalog.channels(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX subscriptions_channel_idx ON catalog.subscriptions(channel_id);

CREATE TABLE catalog.playlists (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES catalog.users(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
    visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX playlists_owner_idx ON catalog.playlists(owner_id,updated_at DESC,id DESC);
CREATE TABLE catalog.playlist_items (
    playlist_id uuid NOT NULL REFERENCES catalog.playlists(id) ON DELETE CASCADE,
    video_id uuid NOT NULL REFERENCES catalog.videos(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position BETWEEN 0 AND 199),
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (playlist_id,video_id),
    CONSTRAINT playlist_position_unique UNIQUE (playlist_id,position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX playlist_items_video_idx ON catalog.playlist_items(video_id);
CREATE TABLE catalog.playlist_create_requests (
    owner_id uuid NOT NULL REFERENCES catalog.users(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    request_hash bytea NOT NULL CHECK (octet_length(request_hash)=32),
    playlist_id uuid REFERENCES catalog.playlists(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id,request_id)
);

ALTER TABLE catalog.videos ADD COLUMN search_document tsvector NOT NULL DEFAULT ''::tsvector;
CREATE FUNCTION catalog.update_video_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.search_document :=
        setweight(to_tsvector('pg_catalog.simple',NEW.title),'A') ||
        setweight(to_tsvector('pg_catalog.simple',array_to_string(NEW.tags,' ')),'A') ||
        setweight(to_tsvector('pg_catalog.simple',NEW.description),'B');
    RETURN NEW;
END;
$$;
CREATE TRIGGER videos_search_update BEFORE INSERT OR UPDATE OF title,tags,description
    ON catalog.videos FOR EACH ROW EXECUTE FUNCTION catalog.update_video_search();
UPDATE catalog.videos SET title=title;
CREATE INDEX videos_search_idx ON catalog.videos USING GIN(search_document)
    WHERE publication_state='published' AND deleted_at IS NULL;
