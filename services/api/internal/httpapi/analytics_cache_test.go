package httpapi

import (
	"context"
	"os"
	"testing"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
)

func TestIntegrationAnalyticsCacheSharesResultsAuthorizesAndRefreshes(t *testing.T) {
	f := setup(t)
	cache, err := newAnalyticsCache(os.Getenv("ANALYTICS_REDIS_URL"))
	if err != nil || cache.client == nil {
		t.Fatal("configure the separate analytics Redis")
	}
	f.App.analytics = cache
	owner := client()
	me, _, _ := registerUser(t, f, owner)
	channel := createChannel(t, f, owner, "cached-analytics")
	video := libraryVideo(t, f, channel.ID, "A cached film")
	grant := playbackGrant(t, f, video, "verified_hls")
	playbackBatch(t, f, grant, 1, store.PlaybackMetrics{PlayedMS: 1000, HTTPBytes: 1000, Quality: 480}, 200)
	var value store.CreatorAnalytics
	path := "/api/v1/channels/" + channel.ID + "/analytics"
	libraryRequest(t, f, owner, "GET", path, nil, 200, &value, nil)
	if value.Totals.HTTPBytes != 1000 || cache.misses.Load() != 1 {
		t.Fatal("miss did not read SQL")
	}
	playbackBatch(t, f, grant, 2, store.PlaybackMetrics{PlayedMS: 2000, HTTPBytes: 2000, Quality: 480}, 200)
	// Another API cache client reuses the shared entry, not a process-local map.
	otherCache, err := newAnalyticsCache(os.Getenv("ANALYTICS_REDIS_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cache.client.Close() })
	f.App.analytics = otherCache
	libraryRequest(t, f, owner, "GET", path, nil, 200, &value, nil)
	if value.Totals.HTTPBytes != 1000 || otherCache.hits.Load() != 1 {
		t.Fatal("shared cache hit was not reused")
	}
	other := client()
	registerUser(t, f, other)
	libraryRequest(t, f, other, "GET", path, nil, 404, nil, nil)
	if otherCache.hits.Load() != 1 {
		t.Fatal("unowned request reached cache")
	}
	libraryRequest(t, f, owner, "GET", path, nil, 200, &value, map[string]string{"Cache-Control": "no-cache"})
	if value.Totals.HTTPBytes != 2000 {
		t.Fatal("refresh did not read current SQL")
	}
	mustExec(t, f, `UPDATE catalog.videos SET title='Changed title',updated_at=now() WHERE id=$1`, video)
	libraryRequest(t, f, owner, "GET", path, nil, 200, &value, nil)
	if len(value.Videos) != 1 || value.Videos[0].Title != "Changed title" {
		t.Fatal("metadata edit did not replace cache key")
	}
	mustExec(t, f, `UPDATE catalog.videos SET deleted_at=now(),updated_at=now() WHERE id=$1`, video)
	libraryRequest(t, f, owner, "GET", "/api/v1/videos/"+video+"/analytics", nil, 404, nil, nil)
	libraryRequest(t, f, owner, "GET", path, nil, 200, &value, nil)
	if len(value.Videos) != 0 || value.Totals.Sessions != 0 {
		t.Fatal("deleted video remained in channel cache")
	}
	if err := otherCache.client.Close(); err != nil {
		t.Fatal(err)
	}
	libraryRequest(t, f, owner, "GET", path, nil, 200, &value, nil)
	if otherCache.errors.Load() == 0 {
		t.Fatal("cache failure did not use SQL fallback")
	}
	allowed, err := f.DB.CreatorAllowed(context.Background(), me.User.ID)
	if err != nil || allowed {
		t.Fatal("ordinary account gained creator approval")
	}
}
