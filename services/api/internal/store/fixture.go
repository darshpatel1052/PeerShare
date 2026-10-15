package store

import (
	"context"
	"errors"
	"regexp"

	"github.com/google/uuid"
)

const FixtureUserID = "00000000-0000-4000-8000-000000000001"
const FixtureChannelID = "00000000-0000-4000-8000-000000000002"
const FixtureVideoID = "00000000-0000-4000-8000-000000000003"

type Fixture struct {
	Generated    bool   `json:"generated"`
	Duration     int    `json:"duration"`
	MediaVersion string `json:"mediaVersion"`
}

func (s *Store) SeedFixture(ctx context.Context, fixture Fixture, unavailablePasswordHash string) error {
	if !fixture.Generated || fixture.Duration != 60 || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(fixture.MediaVersion) {
		return errors.New("seed requires the real generated compatibility fixture metadata")
	}
	generation := uuid.NewSHA1(uuid.NameSpaceURL, []byte("peerscreen:fixture:"+fixture.MediaVersion))
	attempt := uuid.NewSHA1(generation, []byte("fixture-v1"))
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO catalog.users(id,email,display_name,password_hash,role) VALUES($1,'fixture@peerscreen.local','PeerShare Lab',$2,'system') ON CONFLICT(id) DO NOTHING`, FixtureUserID, unavailablePasswordHash); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO catalog.channels(id,owner_id,handle,title,description) VALUES($1,$2,'peerscreen-lab','PeerShare Lab','Small, generated videos that help us build and verify the delivery experience.') ON CONFLICT(id) DO NOTHING`, FixtureChannelID, FixtureUserID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO catalog.videos(id,channel_id,title,description,tags,source_kind,processing_state,publication_state,duration_seconds,accepted_generation_id,accepted_attempt_id,manifest_key,integrity_key,thumbnail_key,qualities,published_at) VALUES($1,$2,'Signal garden','A moving test pattern and a quiet tone, generated to check video quality, seeking, and delivery. Every frame and audio sample is generated locally.',ARRAY['hls','test'],'fixture','ready','published',60,$3,$4,'fixture/master.m3u8','fixture/integrity.json','fixture/thumbnail.jpg',ARRAY[360,480],now()) ON CONFLICT(id) DO UPDATE SET accepted_generation_id=excluded.accepted_generation_id,accepted_attempt_id=excluded.accepted_attempt_id,updated_at=now()`, FixtureVideoID, FixtureChannelID, generation.String(), attempt.String()); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
