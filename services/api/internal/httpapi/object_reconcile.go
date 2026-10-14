package httpapi

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/objectstore"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
)

// A bounded page each minute advances around both buckets. SQL/coordinator
// references, not object age alone, decide whether a deletion is allowed.
func (a *App) sweepObjects(ctx context.Context) {
	if a.Objects == nil || time.Now().Before(a.objectSweepAt) {
		return
	}
	a.objectSweepAt = time.Now().Add(time.Minute)
	cutoff := time.Now().Add(-store.OrphanGrace)
	for index, bucket := range []string{a.Objects.Originals, a.Objects.Processed} {
		items, next, err := a.Objects.ListPage(ctx, bucket, a.objectCursors[index])
		if err != nil {
			a.Logger.Warn("object_sweep_deferred")
			continue
		}
		a.objectCursors[index] = next
		for _, item := range items {
			if item.Key == nil || item.LastModified == nil || !item.LastModified.Before(cutoff) || !objectstore.ValidKey(*item.Key) {
				continue
			}
			key := *item.Key
			var referenced bool
			known := false
			if index == 0 && strings.HasPrefix(key, "sources/") {
				known = true
				referenced, err = a.Store.SourceReferenced(ctx, key)
			} else if index == 0 {
				parts := strings.Split(key, "/")
				if len(parts) == 2 && strings.HasPrefix(parts[1], "part-") {
					if _, ok := canonicalID(parts[0]); ok {
						known = true
						err = a.Store.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM catalog.upload_parts WHERE storage_key=$1)", key).Scan(&referenced)
					}
				}
			} else if strings.HasPrefix(key, "images/") && strings.HasSuffix(key, ".jpg") {
				id := strings.TrimSuffix(strings.TrimPrefix(key, "images/"), ".jpg")
				if _, ok := canonicalID(id); ok {
					known = true
					referenced, err = a.Store.CreatorImageReferenced(ctx, id)
				}
			} else if strings.HasPrefix(key, "videos/") {
				parts := strings.Split(key, "/")
				if len(parts) >= 5 {
					known = true
					for _, id := range parts[1:4] {
						if _, ok := canonicalID(id); !ok {
							known = false
						}
					}
				}
				if known {
					referenced, err = a.attemptReferenced(ctx, parts[1], parts[2], parts[3])
				}
			}
			if known && err == nil && !referenced {
				if err = a.Objects.Delete(ctx, bucket, key); err != nil {
					a.Logger.Warn("object_cleanup_deferred")
				}
			}
		}
	}
	// Crash leftovers are bounded source/verification directories. Live attempts
	// have a 30-minute maximum, so a one-hour grace avoids their staging files.
	entries, err := os.ReadDir(a.Config.MediaDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() || (!strings.HasPrefix(entry.Name(), ".source-") && !strings.HasPrefix(entry.Name(), ".verify-")) {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.ModTime().Before(time.Now().Add(-time.Hour)) {
			_ = os.RemoveAll(filepath.Join(a.Config.MediaDir, entry.Name()))
		}
	}
}
