package store

import "time"

type User struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	Role        string    `json:"role"`
	CreatedAt   time.Time `json:"created_at"`
}

type Channel struct {
	ID               string    `json:"id"`
	OwnerID          string    `json:"-"`
	Handle           string    `json:"handle"`
	Title            string    `json:"title"`
	Description      string    `json:"description"`
	OwnerDisplayName string    `json:"owner_display_name"`
	Revision         int64     `json:"revision"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type Video struct {
	ID              string    `json:"id"`
	ChannelID       string    `json:"channel_id"`
	ChannelTitle    string    `json:"channel_title"`
	ChannelHandle   string    `json:"channel_handle"`
	Title           string    `json:"title"`
	Description     string    `json:"description"`
	Tags            []string  `json:"tags"`
	SourceKind      string    `json:"source_kind"`
	DurationSeconds int       `json:"duration_seconds"`
	GenerationID    string    `json:"accepted_generation_id"`
	AttemptID       string    `json:"accepted_attempt_id"`
	Qualities       []int     `json:"qualities"`
	PublishedAt     time.Time `json:"published_at"`
	ThumbnailURL    string    `json:"thumbnail_url"`
	Playback        *Playback `json:"playback,omitempty"`
	ManifestKey     string    `json:"-"`
	IntegrityKey    string    `json:"-"`
	ThumbnailKey    string    `json:"-"`
}

type Playback struct {
	ManifestURL          string `json:"manifest_url"`
	IntegrityURL         string `json:"integrity_url"`
	TrackerURL           string `json:"tracker_url"`
	PeerSharingAvailable bool   `json:"peer_sharing_available"`
}

type Me struct {
	User    User     `json:"user"`
	Channel *Channel `json:"channel"`
}
type VideosPage struct {
	Items      []Video `json:"items"`
	NextCursor *string `json:"next_cursor"`
}
