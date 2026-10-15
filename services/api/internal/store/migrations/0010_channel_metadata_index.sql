-- Ownership-scoped analytics includes drafts and unpublished videos, so the
-- published-only feed index cannot serve these reads. Keep that scope indexed.
CREATE INDEX videos_channel_metadata_idx ON catalog.videos(channel_id, updated_at DESC)
    INCLUDE (id, deleted_at);

-- Channel-name search merges a bounded page from each matching channel. Include
-- source_kind so filtering out operator fixtures need not fetch each heap row.
DROP INDEX catalog.videos_channel_feed_idx;
CREATE INDEX videos_channel_feed_idx ON catalog.videos(channel_id, published_at DESC, id DESC)
    INCLUDE (source_kind)
    WHERE publication_state='published' AND deleted_at IS NULL;
