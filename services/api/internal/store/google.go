package store

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var ErrIdentityLinked = errors.New("identity already connected to another account")
var ErrAccountLinkRequired = errors.New("explicit account linking required")
var ErrRegistrationDisabled = errors.New("account creation disabled")

type OAuthFlow struct {
	StateHash, BrowserHash, SessionHash []byte
	Nonce, Verifier, Purpose            string
	UserID                              *string
}
type AuthMethods struct {
	Password    bool    `json:"password"`
	GoogleEmail *string `json:"google_email"`
}

func (s *Store) SaveOAuthFlow(ctx context.Context, flow OAuthFlow) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(20061019)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "DELETE FROM catalog.oauth_flows WHERE expires_at<=now()"); err != nil {
		return err
	}
	var count int
	if err = tx.QueryRow(ctx, "SELECT count(*) FROM catalog.oauth_flows").Scan(&count); err != nil {
		return err
	}
	if count >= 1024 {
		return ErrUploadLimit
	}
	_, err = tx.Exec(ctx, `INSERT INTO catalog.oauth_flows(state_hash,browser_hash,nonce,code_verifier,purpose,user_id,session_hash) VALUES($1,$2,$3,$4,$5,$6,$7)`, flow.StateHash, flow.BrowserHash, flow.Nonce, flow.Verifier, flow.Purpose, flow.UserID, flow.SessionHash)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) ConsumeOAuthFlow(ctx context.Context, state, browser []byte) (OAuthFlow, error) {
	var flow OAuthFlow
	err := s.Pool.QueryRow(ctx, `DELETE FROM catalog.oauth_flows WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING nonce,code_verifier,purpose,user_id,session_hash`, state, browser).Scan(&flow.Nonce, &flow.Verifier, &flow.Purpose, &flow.UserID, &flow.SessionHash)
	return flow, translate(err)
}
func (s *Store) AuthMethods(ctx context.Context, user, issuer string) (AuthMethods, error) {
	var methods AuthMethods
	err := s.Pool.QueryRow(ctx, `SELECT password_hash IS NOT NULL,(SELECT provider_email FROM catalog.external_identities WHERE user_id=$1 AND issuer=$2) FROM catalog.users WHERE id=$1`, user, issuer).Scan(&methods.Password, &methods.GoogleEmail)
	return methods, translate(err)
}

// Provider identity, rather than email, is the login key. Email collisions require explicit linking.
func (s *Store) GoogleUser(ctx context.Context, issuer, subject, email, name string, allowRegistration bool) (User, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,20061020))", issuer+"\n"+subject); err != nil {
		return User{}, err
	}
	var user User
	err = tx.QueryRow(ctx, `SELECT u.id,u.email,u.display_name,u.role,u.created_at FROM catalog.external_identities i JOIN catalog.users u ON u.id=i.user_id WHERE i.issuer=$1 AND i.subject=$2 AND u.role<>'system'`, issuer, subject).Scan(&user.ID, &user.Email, &user.DisplayName, &user.Role, &user.CreatedAt)
	if err == nil {
		if _, err = tx.Exec(ctx, "UPDATE catalog.external_identities SET provider_email=$3 WHERE issuer=$1 AND subject=$2", issuer, subject, email); err != nil {
			return User{}, err
		}
		if err = tx.Commit(ctx); err != nil {
			return User{}, err
		}
		return user, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return User{}, err
	}
	var exists bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM catalog.users WHERE email=$1)", email).Scan(&exists); err != nil {
		return User{}, err
	}
	if exists {
		return User{}, ErrAccountLinkRequired
	}
	if !allowRegistration {
		return User{}, ErrRegistrationDisabled
	}
	user.ID = uuid.NewString()
	user.Email = email
	user.DisplayName = name
	err = tx.QueryRow(ctx, `INSERT INTO catalog.users(id,email,display_name,password_hash) VALUES($1,$2,$3,NULL) RETURNING role,created_at`, user.ID, email, name).Scan(&user.Role, &user.CreatedAt)
	if errors.Is(translate(err), ErrEmailTaken) {
		return User{}, ErrAccountLinkRequired
	}
	if err != nil {
		return User{}, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO catalog.external_identities(issuer,subject,user_id,provider_email) VALUES($1,$2,$3,$4)", issuer, subject, user.ID, email); err != nil {
		return User{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return User{}, err
	}
	return user, nil
}
func (s *Store) LinkGoogle(ctx context.Context, user, issuer, subject, email string, sessionHash []byte) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,20061020))", issuer+"\n"+subject); err != nil {
		return err
	}
	var validUser string
	if err = tx.QueryRow(ctx, "SELECT id FROM catalog.users WHERE id=$1 AND password_hash IS NOT NULL AND role<>'system' FOR UPDATE", user).Scan(&validUser); err != nil {
		return translate(err)
	}
	// Recheck the original password-confirmed session after the provider round trip.
	if err = tx.QueryRow(ctx, "SELECT user_id FROM catalog.sessions WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE", sessionHash, user).Scan(&validUser); err != nil {
		return translate(err)
	}
	var existing string
	err = tx.QueryRow(ctx, "SELECT user_id FROM catalog.external_identities WHERE issuer=$1 AND subject=$2", issuer, subject).Scan(&existing)
	if err == nil && existing != user {
		return ErrIdentityLinked
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	// One Google account per PeerShare user. Replacing it is not an implicit side effect of linking.
	var previous string
	err = tx.QueryRow(ctx, "SELECT subject FROM catalog.external_identities WHERE user_id=$1 AND issuer=$2", user, issuer).Scan(&previous)
	if err == nil && previous != subject {
		return ErrIdentityLinked
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO catalog.external_identities(issuer,subject,user_id,provider_email) VALUES($1,$2,$3,$4) ON CONFLICT(issuer,subject) DO UPDATE SET provider_email=EXCLUDED.provider_email`, issuer, subject, user, email)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
