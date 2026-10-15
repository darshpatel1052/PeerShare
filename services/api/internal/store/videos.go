package store

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Cursor struct {
	PublishedAt time.Time `json:"published_at"`
	ID          string    `json:"id"`
}

func EncodeCursor(v Video) string {
	data, _ := json.Marshal(Cursor{PublishedAt: v.PublishedAt, ID: v.ID})
	return base64.RawURLEncoding.EncodeToString(data)
}
func DecodeCursor(raw string) (*Cursor, error) {
	if raw == "" {
		return nil, nil
	}
	if len(raw) > 512 {
		return nil, errors.New("cursor is too large")
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, errors.New("invalid cursor")
	}
	var cursor Cursor
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&cursor); err != nil || cursor.PublishedAt.IsZero() {
		return nil, errors.New("invalid cursor")
	}
	id, err := uuid.Parse(cursor.ID)
	if err != nil || id.String() != cursor.ID {
		return nil, errors.New("invalid cursor ID")
	}
	// Reject trailing values as well as malformed data.
	if decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("invalid cursor")
	}
	return &cursor, nil
}

const videoColumns = `v.id,v.channel_id,c.title,c.handle,v.title,v.description,v.tags,v.source_kind,v.duration_seconds,v.accepted_generation_id,v.accepted_attempt_id,v.qualities,v.published_at,v.manifest_key,v.integrity_key,v.thumbnail_key,COALESCE(v.thumbnail_image_id::text,'')`
const visibleVideo = `v.publication_state='published' AND v.deleted_at IS NULL`

func scanVideo(row interface{ Scan(...any) error }) (Video, error) {
	var v Video
	err := row.Scan(&v.ID, &v.ChannelID, &v.ChannelTitle, &v.ChannelHandle, &v.Title, &v.Description, &v.Tags, &v.SourceKind, &v.DurationSeconds, &v.GenerationID, &v.AttemptID, &v.Qualities, &v.PublishedAt, &v.ManifestKey, &v.IntegrityKey, &v.ThumbnailKey, &v.ThumbnailImageID)
	return v, translate(err)
}
func (s *Store) Video(ctx context.Context, id string) (Video, error) {
	return scanVideo(s.Pool.QueryRow(ctx, "SELECT "+videoColumns+" FROM catalog.videos v JOIN catalog.channels c ON c.id=v.channel_id WHERE "+visibleVideo+" AND v.id=$1", id))
}
func (s *Store) Videos(ctx context.Context, limit int, channelID *string, cursor *Cursor, includeFixture bool) (VideosPage, error) {
	return s.SearchVideos(ctx, limit, channelID, cursor, includeFixture, "", "")
}

func (s *Store) SearchVideos(ctx context.Context, limit int, channelID *string, cursor *Cursor, includeFixture bool, query, followingUserID string) (VideosPage, error) {
	args := []any{limit + 1}
	bind := func(value any) string {
		args = append(args, value)
		return fmt.Sprintf("$%d", len(args))
	}
	conditions := []string{visibleVideo}
	if channelID != nil {
		conditions = append(conditions, "v.channel_id="+bind(*channelID)+"::uuid")
	}
	if cursor != nil {
		conditions = append(conditions, "(v.published_at,v.id)<("+bind(cursor.PublishedAt)+"::timestamptz,"+bind(cursor.ID)+"::uuid)")
	}
	if !includeFixture {
		conditions = append(conditions, "v.source_kind<>'fixture'")
	}
	if followingUserID != "" {
		conditions = append(conditions, "EXISTS(SELECT 1 FROM catalog.subscriptions sub WHERE sub.user_id="+bind(followingUserID)+"::uuid AND sub.channel_id=v.channel_id)")
	}
	where := strings.Join(conditions, " AND ")
	order := " ORDER BY v.published_at DESC,v.id DESC LIMIT $1"
	statement := "SELECT " + videoColumns + " FROM catalog.videos v JOIN catalog.channels c ON c.id=v.channel_id WHERE " + where + order
	if query != "" {
		term := bind(query)
		// An OR spanning video text and channel title forces PostgreSQL to test
		// unrelated video rows, particularly for absent terms. Find each branch's
		// newest page independently, then deduplicate before the final page limit.
		// Applying the same cursor/visibility/following filters in both branches
		// preserves ordering and ensures a video matching both appears only once.
		statement = "WITH matching_channels AS MATERIALIZED (SELECT id FROM catalog.channels WHERE strpos(lower(title),lower(" + term + "::text))>0), candidates AS ((SELECT v.id,v.published_at FROM catalog.videos v WHERE " + where + " AND v.search_document @@ websearch_to_tsquery('pg_catalog.simple'," + term + "::text)" + order + ") UNION (SELECT v.id,v.published_at FROM catalog.videos v JOIN matching_channels mc ON mc.id=v.channel_id WHERE " + where + order + ")) SELECT " + videoColumns + " FROM candidates hit JOIN catalog.videos v ON v.id=hit.id JOIN catalog.channels c ON c.id=v.channel_id" + order
	}
	rows, err := s.Pool.Query(ctx, statement, args...)
	if err != nil {
		return VideosPage{}, err
	}
	defer rows.Close()
	page := VideosPage{Items: make([]Video, 0, limit)}
	for rows.Next() {
		video, err := scanVideo(rows)
		if err != nil {
			return VideosPage{}, err
		}
		page.Items = append(page.Items, video)
	}
	if err := rows.Err(); err != nil {
		return VideosPage{}, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		next := EncodeCursor(page.Items[len(page.Items)-1])
		page.NextCursor = &next
	}
	return page, nil
}

func (s *Store) PreviewVideo(ctx context.Context, ownerID, id string) (Video, error) {
	columns := strings.Replace(videoColumns, "v.published_at", "COALESCE(v.published_at,v.created_at)", 1)
	return scanVideo(s.Pool.QueryRow(ctx, "SELECT "+columns+" FROM catalog.videos v JOIN catalog.channels c ON c.id=v.channel_id WHERE v.id=$1 AND c.owner_id=$2 AND v.deleted_at IS NULL AND v.processing_state='ready'", id, ownerID))
}
