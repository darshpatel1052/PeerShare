package store

import (
	"context"
	"errors"
	"fmt"
)

func (s *Store) CreatorAllowed(ctx context.Context, userID string) (bool, error) {
	var allowed bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM catalog.creator_access WHERE user_id=$1 AND expires_at>now())`, userID).Scan(&allowed)
	return allowed, err
}
func (s *Store) GrantCreator(ctx context.Context, userID string, hours int) error {
	if hours < 1 || hours > 720 {
		return errors.New("creator access lasts from 1 to 720 hours")
	}
	_, err := s.Pool.Exec(ctx, `INSERT INTO catalog.creator_access(user_id,expires_at) VALUES($1,now()+$2::interval)
		ON CONFLICT(user_id) DO UPDATE SET granted_at=now(),expires_at=excluded.expires_at`, userID, fmt.Sprintf("%d hours", hours))
	return translate(err)
}
func (s *Store) RevokeCreator(ctx context.Context, userID string) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM catalog.creator_access WHERE user_id=$1`, userID)
	return err
}
