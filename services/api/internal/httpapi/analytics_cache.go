package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/darshpatel1052/PeerShare/services/api/internal/store"
	"github.com/redis/go-redis/v9"
)

const analyticsTTL = 15 * time.Second
const maxAnalyticsCacheBytes = 256 << 10

type analyticsCache struct {
	client                         *redis.Client
	hits, misses, errors, bypasses atomic.Uint64
}

// The optional cache has its own Redis process/memory budget. It is never the
// authority for ownership, sessions, upload capacity or publication.
func newAnalyticsCache(rawURL string) (*analyticsCache, error) {
	cache := &analyticsCache{}
	if rawURL == "" {
		return cache, nil
	}
	opts, err := redis.ParseURL(rawURL)
	if err != nil {
		return nil, err
	}
	opts.DialTimeout, opts.ReadTimeout, opts.WriteTimeout = 150*time.Millisecond, 150*time.Millisecond, 150*time.Millisecond
	opts.ContextTimeoutEnabled = true
	opts.MaxRetries = -1
	cache.client = redis.NewClient(opts)
	return cache, nil
}

func (a *App) creatorAnalytics(r *http.Request, channel string, video *string) (store.CreatorAnalytics, error) {
	// This SQL check runs even on a hit. The version changes with title edits,
	// publication/deletion and channel edits, so metadata changes abandon old keys.
	version, err := a.Store.AnalyticsScope(r.Context(), identity(r).ID, channel, video)
	if err != nil {
		return store.CreatorAnalytics{}, err
	}
	key := "peerscreen:analytics:v1:" + identity(r).ID + ":" + channel + ":" + version
	if video != nil {
		key += ":" + *video
	}
	cache := a.analytics
	fresh := strings.Contains(r.Header.Get("Cache-Control"), "no-cache")
	if cache.client != nil && !fresh {
		ctx, cancel := context.WithTimeout(r.Context(), 200*time.Millisecond)
		data, e := cache.client.Get(ctx, key).Bytes()
		cancel()
		var value store.CreatorAnalytics
		if e == nil && len(data) <= maxAnalyticsCacheBytes && json.Unmarshal(data, &value) == nil {
			cache.hits.Add(1)
			return value, nil
		}
		if e != nil && e != redis.Nil {
			cache.errors.Add(1)
		} else {
			cache.misses.Add(1)
		}
	} else {
		cache.bypasses.Add(1)
	}
	value, err := a.Store.CreatorAnalytics(r.Context(), identity(r).ID, channel, video)
	if err == nil && cache.client != nil {
		data, marshalErr := json.Marshal(value)
		if marshalErr == nil && len(data) <= maxAnalyticsCacheBytes {
			ctx, cancel := context.WithTimeout(r.Context(), 200*time.Millisecond)
			if cache.client.Set(ctx, key, data, analyticsTTL).Err() != nil {
				cache.errors.Add(1)
			}
			cancel()
		}
	}
	return value, err
}
