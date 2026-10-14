package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var ErrLibraryLimit = errors.New("library capacity reached")
var ErrLibraryConflict = errors.New("library request conflicts")

type Subscription struct {
	Following bool  `json:"following"`
	Followers int64 `json:"followers"`
}

func (s *Store) Subscription(ctx context.Context, userID, channelID string) (Subscription, error) {
	var result Subscription
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM catalog.subscriptions WHERE channel_id=c.id AND user_id=NULLIF($2,'')::uuid), (SELECT count(*) FROM catalog.subscriptions WHERE channel_id=c.id) FROM catalog.channels c WHERE c.id=$1`, channelID, userID).Scan(&result.Following, &result.Followers)
	return result, translate(err)
}
func (s *Store) SetSubscription(ctx context.Context, userID, channelID string, following bool) (Subscription, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Subscription{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,20061040))`, userID); err != nil {
		return Subscription{}, err
	}
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM catalog.channels WHERE id=$1)`, channelID).Scan(&exists); err != nil {
		return Subscription{}, err
	}
	if !exists {
		return Subscription{}, ErrNotFound
	}
	if following {
		var count int
		if err = tx.QueryRow(ctx, `SELECT count(*) FROM catalog.subscriptions WHERE user_id=$1 AND channel_id<>$2`, userID, channelID).Scan(&count); err != nil {
			return Subscription{}, err
		}
		if count >= 500 {
			return Subscription{}, ErrLibraryLimit
		}
		_, err = tx.Exec(ctx, `INSERT INTO catalog.subscriptions(user_id,channel_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, userID, channelID)
	} else {
		_, err = tx.Exec(ctx, `DELETE FROM catalog.subscriptions WHERE user_id=$1 AND channel_id=$2`, userID, channelID)
	}
	if err != nil {
		return Subscription{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Subscription{}, err
	}
	return s.Subscription(ctx, userID, channelID)
}
func (s *Store) SubscribedChannels(ctx context.Context, userID string) ([]Channel, error) {
	rows, err := s.Pool.Query(ctx, `SELECT `+channelColumns+` FROM catalog.channels c JOIN catalog.users u ON u.id=c.owner_id JOIN catalog.subscriptions sub ON sub.channel_id=c.id WHERE sub.user_id=$1 ORDER BY c.title,c.id LIMIT 500`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Channel, 0)
	for rows.Next() {
		c, err := scanChannel(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

type Playlist struct {
	ID         string    `json:"id"`
	OwnerID    string    `json:"-"`
	Title      string    `json:"title"`
	Visibility string    `json:"visibility"`
	Revision   int64     `json:"revision"`
	ItemCount  int       `json:"item_count"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}
type PlaylistItem struct {
	VideoID  string `json:"video_id"`
	Position int    `json:"position"`
	Video    *Video `json:"video"`
}
type PlaylistDetail struct {
	Playlist Playlist       `json:"playlist"`
	IsOwner  bool           `json:"is_owner"`
	Items    []PlaylistItem `json:"items"`
}

const playlistColumns = `p.id,p.owner_id,p.title,p.visibility,p.revision,p.created_at,p.updated_at`

func scanPlaylist(row interface{ Scan(...any) error }) (Playlist, error) {
	var p Playlist
	err := row.Scan(&p.ID, &p.OwnerID, &p.Title, &p.Visibility, &p.Revision, &p.CreatedAt, &p.UpdatedAt)
	return p, translate(err)
}
func (s *Store) Playlists(ctx context.Context, userID string) ([]Playlist, error) {
	rows, err := s.Pool.Query(ctx, `SELECT `+playlistColumns+`,(SELECT count(*) FROM catalog.playlist_items i WHERE i.playlist_id=p.id) FROM catalog.playlists p WHERE p.owner_id=$1 ORDER BY p.updated_at DESC,p.id DESC LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Playlist, 0)
	for rows.Next() {
		var p Playlist
		if err = rows.Scan(&p.ID, &p.OwnerID, &p.Title, &p.Visibility, &p.Revision, &p.CreatedAt, &p.UpdatedAt, &p.ItemCount); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, rows.Err()
}
func (s *Store) CreatePlaylist(ctx context.Context, userID, requestID, title, visibility string) (Playlist, error) {
	data, _ := json.Marshal([]string{title, visibility})
	sum := sha256.Sum256(data)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Playlist{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,20061041))`, userID); err != nil {
		return Playlist{}, err
	}
	var stored []byte
	var id *string
	err = tx.QueryRow(ctx, `SELECT request_hash,playlist_id::text FROM catalog.playlist_create_requests WHERE owner_id=$1 AND request_id=$2`, userID, requestID).Scan(&stored, &id)
	if err == nil {
		if !bytes.Equal(stored, sum[:]) || id == nil {
			return Playlist{}, ErrLibraryConflict
		}
		return scanPlaylist(tx.QueryRow(ctx, `SELECT `+playlistColumns+` FROM catalog.playlists p WHERE p.id=$1`, *id))
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Playlist{}, err
	}
	var count, requests int
	if err = tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM catalog.playlists WHERE owner_id=$1),(SELECT count(*) FROM catalog.playlist_create_requests WHERE owner_id=$1)`, userID).Scan(&count, &requests); err != nil {
		return Playlist{}, err
	}
	if count >= 50 || requests >= 500 {
		return Playlist{}, ErrLibraryLimit
	}
	idValue := uuid.NewString()
	p, err := scanPlaylist(tx.QueryRow(ctx, `INSERT INTO catalog.playlists AS p(id,owner_id,title,visibility) VALUES($1,$2,$3,$4) RETURNING `+playlistColumns, idValue, userID, title, visibility))
	if err != nil {
		return Playlist{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO catalog.playlist_create_requests(owner_id,request_id,request_hash,playlist_id) VALUES($1,$2,$3,$4)`, userID, requestID, sum[:], idValue); err != nil {
		return Playlist{}, err
	}
	return p, tx.Commit(ctx)
}
func (s *Store) Playlist(ctx context.Context, id, userID string, includeFixture bool) (PlaylistDetail, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return PlaylistDetail{}, err
	}
	defer tx.Rollback(ctx)
	p, err := scanPlaylist(tx.QueryRow(ctx, `SELECT `+playlistColumns+` FROM catalog.playlists p WHERE p.id=$1 AND (p.visibility='public' OR p.owner_id=NULLIF($2,'')::uuid)`, id, userID))
	if err != nil {
		return PlaylistDetail{}, err
	}
	result := PlaylistDetail{Playlist: p, IsOwner: p.OwnerID == userID, Items: make([]PlaylistItem, 0)}
	rows, err := tx.Query(ctx, `SELECT i.video_id,i.position FROM catalog.playlist_items i WHERE i.playlist_id=$1 ORDER BY i.position`, id)
	if err != nil {
		return PlaylistDetail{}, err
	}
	defer rows.Close()
	type entry struct {
		id       string
		position int
	}
	entries := make([]entry, 0)
	for rows.Next() {
		var e entry
		if err = rows.Scan(&e.id, &e.position); err != nil {
			return PlaylistDetail{}, err
		}
		entries = append(entries, e)
	}
	if err = rows.Err(); err != nil {
		return PlaylistDetail{}, err
	}
	rows.Close()
	videos := make(map[string]Video)
	rows, err = tx.Query(ctx, `SELECT `+videoColumns+` FROM catalog.playlist_items i JOIN catalog.videos v ON v.id=i.video_id JOIN catalog.channels c ON c.id=v.channel_id WHERE i.playlist_id=$1 AND `+visibleVideo+` AND ($2 OR v.source_kind<>'fixture') ORDER BY i.position`, id, includeFixture)
	if err != nil {
		return PlaylistDetail{}, err
	}
	defer rows.Close()
	for rows.Next() {
		v, err := scanVideo(rows)
		if err != nil {
			return PlaylistDetail{}, err
		}
		videos[v.ID] = v
	}
	if err = rows.Err(); err != nil {
		return PlaylistDetail{}, err
	}
	rows.Close()
	for _, e := range entries {
		item := PlaylistItem{VideoID: e.id, Position: e.position}
		if v, ok := videos[e.id]; ok {
			item.Video = &v
		}
		if item.Video != nil || result.IsOwner {
			if !result.IsOwner {
				item.Position = len(result.Items)
			}
			result.Items = append(result.Items, item)
		}
	}
	result.Playlist.ItemCount = len(result.Items)
	return result, tx.Commit(ctx)
}

type PlaylistMutation struct {
	Action     string
	Title      string
	Visibility string
	VideoID    string
	VideoIDs   []string
	Revision   int64
}

func (s *Store) MutatePlaylist(ctx context.Context, id, userID string, m PlaylistMutation, includeFixture bool) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	p, err := scanPlaylist(tx.QueryRow(ctx, `SELECT `+playlistColumns+` FROM catalog.playlists p WHERE p.id=$1 AND p.owner_id=$2 FOR UPDATE`, id, userID))
	if err != nil {
		return err
	}
	if p.Revision != m.Revision {
		return ErrRevisionConflict
	}
	switch m.Action {
	case "edit":
		_, err = tx.Exec(ctx, `UPDATE catalog.playlists SET title=$2,visibility=$3 WHERE id=$1`, id, m.Title, m.Visibility)
	case "add":
		var visible, exists bool
		var count int
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM catalog.videos v WHERE v.id=$2 AND `+visibleVideo+` AND ($3 OR v.source_kind<>'fixture')),EXISTS(SELECT 1 FROM catalog.playlist_items WHERE playlist_id=$1 AND video_id=$2),(SELECT count(*) FROM catalog.playlist_items WHERE playlist_id=$1)`, id, m.VideoID, includeFixture).Scan(&visible, &exists, &count)
		if err != nil {
			return err
		}
		if !visible {
			return ErrNotFound
		}
		if exists {
			return tx.Commit(ctx)
		}
		if count >= 200 {
			return ErrLibraryLimit
		}
		_, err = tx.Exec(ctx, `INSERT INTO catalog.playlist_items(playlist_id,video_id,position) VALUES($1,$2,$3)`, id, m.VideoID, count)
	case "remove":
		_, err = tx.Exec(ctx, `DELETE FROM catalog.playlist_items WHERE playlist_id=$1 AND video_id=$2`, id, m.VideoID)
		if err == nil {
			_, err = tx.Exec(ctx, `UPDATE catalog.playlist_items i SET position=ordered.n FROM (SELECT video_id,(row_number() OVER(ORDER BY position)-1)::integer AS n FROM catalog.playlist_items WHERE playlist_id=$1) ordered WHERE i.playlist_id=$1 AND i.video_id=ordered.video_id`, id)
		}
	case "reorder":
		var existing []string
		err = tx.QueryRow(ctx, `SELECT COALESCE(array_agg(video_id::text ORDER BY position),'{}'::text[]) FROM catalog.playlist_items WHERE playlist_id=$1`, id).Scan(&existing)
		if err != nil {
			return err
		}
		if len(existing) != len(m.VideoIDs) {
			return ErrLibraryConflict
		}
		set := make(map[string]bool, len(existing))
		for _, v := range existing {
			set[v] = true
		}
		for position, v := range m.VideoIDs {
			if !set[v] {
				return ErrLibraryConflict
			}
			delete(set, v)
			if _, err = tx.Exec(ctx, `UPDATE catalog.playlist_items SET position=$3 WHERE playlist_id=$1 AND video_id=$2`, id, v, position); err != nil {
				return err
			}
		}
	default:
		return ErrLibraryConflict
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE catalog.playlists SET revision=revision+1,updated_at=now() WHERE id=$1`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) DeletePlaylist(ctx context.Context, id, userID string, revision int64) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	p, err := scanPlaylist(tx.QueryRow(ctx, `SELECT `+playlistColumns+` FROM catalog.playlists p WHERE p.id=$1 AND p.owner_id=$2 FOR UPDATE`, id, userID))
	if err != nil {
		return err
	}
	if p.Revision != revision {
		return ErrRevisionConflict
	}
	if _, err = tx.Exec(ctx, `DELETE FROM catalog.playlists WHERE id=$1`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
