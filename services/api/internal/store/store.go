package store

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

var (
	ErrNotFound         = errors.New("record not found")
	ErrEmailTaken       = errors.New("email already registered")
	ErrHandleTaken      = errors.New("channel handle is taken")
	ErrChannelExists    = errors.New("user already has a channel")
	ErrNotOwner         = errors.New("channel belongs to another user")
	ErrRevisionConflict = errors.New("channel revision changed")
)

type Store struct{ Pool *pgxpool.Pool }

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, errors.New("invalid DATABASE_URL")
	}
	cfg.MaxConns = 16
	cfg.MinConns = 1
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	cfg.ConnConfig.RuntimeParams["statement_timeout"] = "3000"
	cfg.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"] = "5000"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{Pool: pool}, nil
}

// Migration checksum + transaction + advisory lock make re-runs and concurrent starts explicit.
func (s *Store) Migrate(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SET LOCAL statement_timeout = '30s'"); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(20061013)"); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS catalog.schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	files, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	for _, file := range files {
		sql, err := migrations.ReadFile("migrations/" + file.Name())
		if err != nil {
			return err
		}
		sum := sha256.Sum256(sql)
		checksum := hex.EncodeToString(sum[:])
		var previous string
		err = tx.QueryRow(ctx, "SELECT checksum FROM catalog.schema_migrations WHERE version=$1", file.Name()).Scan(&previous)
		if err == nil {
			if previous != checksum {
				return fmt.Errorf("applied migration %s changed; create a new migration", file.Name())
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "INSERT INTO catalog.schema_migrations(version,checksum) VALUES($1,$2)", file.Name(), checksum); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func translate(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		switch pgErr.ConstraintName {
		case "users_email_key":
			return ErrEmailTaken
		case "channels_handle_key":
			return ErrHandleTaken
		case "channels_owner_id_key":
			return ErrChannelExists
		}
	}
	return err
}

// pgxpool.Pool and pgx.Tx both satisfy this small interface without an implements declaration.
type queryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func saveSession(ctx context.Context, db queryRower, userID string, hash []byte, ttl time.Duration) (time.Time, error) {
	var expiry time.Time
	err := db.QueryRow(ctx, "INSERT INTO catalog.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3 * interval '1 second')) RETURNING expires_at", hash, userID, int64(ttl.Seconds())).Scan(&expiry)
	return expiry, err
}
