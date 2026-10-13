package store

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
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
	var afterTime *time.Time
	var afterID *string
	if cursor != nil {
		afterTime = &cursor.PublishedAt
		afterID = &cursor.ID
	}
	rows, err := s.Pool.Query(ctx, "SELECT "+videoColumns+" FROM catalog.videos v JOIN catalog.channels c ON c.id=v.channel_id WHERE "+visibleVideo+` AND ($1::uuid IS NULL OR v.channel_id=$1) AND ($2::timestamptz IS NULL OR (v.published_at,v.id)<($2,$3::uuid)) AND ($5 OR v.source_kind<>'fixture') ORDER BY v.published_at DESC,v.id DESC LIMIT $4`, channelID, afterTime, afterID, limit+1, includeFixture)
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
