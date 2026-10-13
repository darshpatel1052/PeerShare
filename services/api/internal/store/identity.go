package store

import (
	"context"
	"time"
)

func (s *Store) Register(ctx context.Context, user User, passwordHash string, sessionHash []byte, ttl time.Duration) (User, time.Time, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return User{}, time.Time{}, err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx, `INSERT INTO catalog.users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4) RETURNING role,created_at`, user.ID, user.Email, user.DisplayName, passwordHash).Scan(&user.Role, &user.CreatedAt)
	if err != nil {
		return User{}, time.Time{}, translate(err)
	}
	expiry, err := saveSession(ctx, tx, user.ID, sessionHash, ttl)
	if err != nil {
		return User{}, time.Time{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return User{}, time.Time{}, err
	}
	return user, expiry, nil
}

func (s *Store) UserForLogin(ctx context.Context, email string) (User, string, error) {
	var user User
	var hash string
	err := s.Pool.QueryRow(ctx, `SELECT id,email,display_name,role,created_at,password_hash FROM catalog.users WHERE email=$1 AND role <> 'system'`, email).Scan(&user.ID, &user.Email, &user.DisplayName, &user.Role, &user.CreatedAt, &hash)
	return user, hash, translate(err)
}

func (s *Store) CreateSession(ctx context.Context, userID string, hash []byte, ttl time.Duration) (time.Time, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return time.Time{}, err
	}
	defer tx.Rollback(ctx)
	var lockedID string
	if err := tx.QueryRow(ctx, "SELECT id FROM catalog.users WHERE id=$1 FOR UPDATE", userID).Scan(&lockedID); err != nil {
		return time.Time{}, translate(err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM catalog.sessions WHERE user_id=$1 AND (expires_at<=now() OR revoked_at IS NOT NULL)", userID); err != nil {
		return time.Time{}, err
	}
	expiry, err := saveSession(ctx, tx, userID, hash, ttl)
	if err != nil {
		return time.Time{}, err
	}
	// Keep this session plus at most nineteen other active sessions.
	if _, err := tx.Exec(ctx, `UPDATE catalog.sessions SET revoked_at=now() WHERE token_hash IN (SELECT token_hash FROM catalog.sessions WHERE user_id=$1 AND token_hash<>$2 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC,token_hash DESC OFFSET 19)`, userID, hash); err != nil {
		return time.Time{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return time.Time{}, err
	}
	return expiry, nil
}

func (s *Store) SessionUser(ctx context.Context, hash []byte) (User, error) {
	var user User
	err := s.Pool.QueryRow(ctx, `SELECT u.id,u.email,u.display_name,u.role,u.created_at FROM catalog.sessions s JOIN catalog.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.role<>'system'`, hash).Scan(&user.ID, &user.Email, &user.DisplayName, &user.Role, &user.CreatedAt)
	return user, translate(err)
}

func (s *Store) RevokeSession(ctx context.Context, hash []byte) error {
	_, err := s.Pool.Exec(ctx, "UPDATE catalog.sessions SET revoked_at=coalesce(revoked_at,now()) WHERE token_hash=$1", hash)
	return err
}
func (s *Store) RevokeAllSessions(ctx context.Context, userID string) error {
	_, err := s.Pool.Exec(ctx, "UPDATE catalog.sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1", userID)
	return err
}

func (s *Store) Me(ctx context.Context, user User) (Me, error) {
	channel, err := s.channelByOwner(ctx, user.ID)
	if err == ErrNotFound {
		return Me{User: user}, nil
	}
	if err != nil {
		return Me{}, err
	}
	return Me{User: user, Channel: &channel}, nil
}
