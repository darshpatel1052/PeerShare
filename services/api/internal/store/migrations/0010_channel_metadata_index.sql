-- Ownership-scoped analytics includes drafts and unpublished videos, so the
-- published-only feed index cannot serve these reads. Keep that scope indexed.
CREATE INDEX videos_channel_metadata_idx ON catalog.videos(channel_id, updated_at DESC)
    INCLUDE (id, deleted_at);
