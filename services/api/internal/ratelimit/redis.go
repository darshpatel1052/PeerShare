package ratelimit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/redis/go-redis/v9"
)

type Limiter struct {
	Client *redis.Client
	Prefix string
	Limit  int64
	Window time.Duration
}

// INCR and first-use expiry are one atomic operation across API replicas.
var counter = redis.NewScript(`
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}
`)

func (l *Limiter) Check(ctx context.Context, address string) (bool, int, error) {
	digest := sha256.Sum256([]byte(address))
	key := l.Prefix + ":" + hex.EncodeToString(digest[:])
	values, err := counter.Run(ctx, l.Client, []string{key}, l.Window.Milliseconds()).Int64Slice()
	if err != nil {
		return false, 0, err
	}
	return values[0] <= l.Limit, int((values[1] + 999) / 1000), nil
}
