package store

import (
	"context"
	"time"
)

const ImageStorageCeiling int64 = 64 * 1024 * 1024 // Within the platform's existing 128 MiB allowance.

// SetCreatorImage serializes quota admission and checks ownership/revision in the same transaction.
// A nil image resets the default. Old images remain accounted for until reconciliation removes them.
func (s *Store) SetCreatorImage(ctx context.Context, owner, resource, kind string, revision int64, image *string, bytes int) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(20061014)"); err != nil {
		return err
	}
	var storedOwner string
	var storedRevision int64
	table, column := "catalog.channels", "banner_image_id"
	query := "SELECT owner_id,revision FROM catalog.channels WHERE id=$1 FOR UPDATE"
	if kind == "thumbnail" {
		table, column = "catalog.videos", "thumbnail_image_id"
		query = "SELECT c.owner_id,v.revision FROM catalog.videos v JOIN catalog.channels c ON c.id=v.channel_id WHERE v.id=$1 AND v.deleted_at IS NULL FOR UPDATE OF v"
	}
	if err = tx.QueryRow(ctx, query, resource).Scan(&storedOwner, &storedRevision); err != nil {
		return translate(err)
	}
	if storedOwner != owner {
		return ErrNotOwner
	}
	if revision != storedRevision {
		return ErrRevisionConflict
	}
	if image != nil {
		var used int64
		if err = tx.QueryRow(ctx, "SELECT COALESCE(sum(byte_length),0) FROM catalog.creator_images").Scan(&used); err != nil {
			return err
		}
		if used+int64(bytes) > ImageStorageCeiling {
			return ErrUploadLimit
		}
		if _, err = tx.Exec(ctx, "INSERT INTO catalog.creator_images(id,owner_id,byte_length) VALUES($1,$2,$3)", *image, owner, bytes); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, "UPDATE "+table+" SET "+column+"=$1,revision=revision+1,updated_at=now() WHERE id=$2", image, resource); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) CanReadCreatorImage(ctx context.Context, owner, id string) (bool, error) {
	var visible bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM catalog.channels WHERE banner_image_id=$1) OR EXISTS(SELECT 1 FROM catalog.videos v JOIN catalog.channels c ON c.id=v.channel_id WHERE v.thumbnail_image_id=$1 AND v.deleted_at IS NULL AND (v.publication_state='published' OR c.owner_id=$2::uuid))`, id, nullableUUID(owner)).Scan(&visible)
	return visible, err
}

func nullableUUID(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}

func (s *Store) CreatorImageReferenced(ctx context.Context, id string) (bool, error) {
	var found bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM catalog.channels WHERE banner_image_id=$1) OR EXISTS(SELECT 1 FROM catalog.videos WHERE thumbnail_image_id=$1 AND deleted_at IS NULL)`, id).Scan(&found)
	return found, err
}

func (s *Store) ForgetCreatorImage(ctx context.Context, id string, cutoff time.Time) error {
	// Deleted videos retain their tombstones, but no longer retain artwork.
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "UPDATE catalog.videos SET thumbnail_image_id=NULL WHERE thumbnail_image_id=$1 AND deleted_at IS NOT NULL", id); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM catalog.creator_images i WHERE id=$1 AND created_at<$2 AND NOT EXISTS(SELECT 1 FROM catalog.channels WHERE banner_image_id=i.id) AND NOT EXISTS(SELECT 1 FROM catalog.videos WHERE thumbnail_image_id=i.id)`, id, cutoff); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
