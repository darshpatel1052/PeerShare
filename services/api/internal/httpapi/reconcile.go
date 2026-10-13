package httpapi

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
)

// Reconciliation repeats after any crash. Capacity is released only after filesystem cleanup succeeds.
func (a *App) reconcileMedia(ctx context.Context) {
	if err := a.Store.RecoverJobs(ctx); err != nil {
		if ctx.Err() == nil {
			a.Logger.Warn("media_recovery_deferred")
		}
		return
	}
	a.measureLegacyOutputs(ctx)
	candidates, err := a.Store.CleanupCandidates(ctx)
	if err != nil {
		return
	}
	for _, c := range candidates {
		// An exclusive upload lock prevents releasing space underneath an in-flight part or assembler.
		conn, err := a.Store.Pool.Acquire(ctx)
		if err != nil {
			return
		}
		var locked bool
		e := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtextextended($1,20061017))", c.ID).Scan(&locked)
		if e == nil && locked {
			a.cleanupUpload(ctx, c)
			dbctx, stop := cleanupContext()
			_, e = conn.Exec(dbctx, "SELECT pg_advisory_unlock(hashtextextended($1,20061017))", c.ID)
			if e != nil {
				conn.Hijack().Close(dbctx)
			}
			stop()
		}
		conn.Release()
	}

	// Staging files from interrupted writes are never authoritative. Preserve a grace period for in-flight writes.
	cutoff := time.Now().Add(-store.OrphanGrace)
	swept := true
	_ = filepath.WalkDir(a.Config.UploadDir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			swept = false
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		info, e := entry.Info()
		if e != nil || info.ModTime().After(cutoff) {
			return nil
		}
		if strings.HasSuffix(entry.Name(), ".tmp") {
			_ = os.Remove(path)
			return nil
		}
		if strings.HasPrefix(entry.Name(), "part-") {
			key, _ := filepath.Rel(a.Config.UploadDir, path)
			var referenced bool
			e := a.Store.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM catalog.upload_parts WHERE storage_key=$1)", filepath.ToSlash(key)).Scan(&referenced)
			if e == nil && !referenced {
				if e = os.Remove(path); e != nil && !os.IsNotExist(e) {
					swept = false
				}
			}
		}
		if filepath.Dir(path) == filepath.Join(a.Config.UploadDir, "sources") {
			key, _ := filepath.Rel(a.Config.UploadDir, path)
			referenced, e := a.Store.SourceReferenced(ctx, filepath.ToSlash(key))
			if e == nil && !referenced {
				_ = os.Remove(path)
			}
		}
		return nil
	})
	root := filepath.Join(a.Config.MediaDir, "videos")
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if !os.IsNotExist(walkErr) {
				swept = false
			}
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		rel, e := filepath.Rel(root, path)
		if e != nil || len(strings.Split(rel, string(filepath.Separator))) != 3 {
			return nil
		}
		info, e := entry.Info()
		if e != nil || info.ModTime().After(cutoff) {
			return filepath.SkipDir
		}
		referenced, e := a.Store.AttemptReferenced(ctx, entry.Name())
		if e == nil && !referenced {
			_ = os.RemoveAll(path)
		}
		return filepath.SkipDir
	})
	if swept {
		_ = a.Store.SettleReservations(ctx)
	}
}

func (a *App) cleanupUpload(ctx context.Context, c store.Cleanup) {
	if err := os.RemoveAll(filepath.Join(a.Config.UploadDir, c.ID)); err != nil {
		return
	}
	if c.Deleted || c.State == "aborted" || c.State == "expired" {
		names, err := filepath.Glob(filepath.Join(a.Config.UploadDir, "sources", c.VideoID+"-*"))
		if err != nil {
			return
		}
		for _, name := range names {
			if err = os.Remove(name); err != nil && !os.IsNotExist(err) {
				return
			}
		}
		if c.SourceKey != "" {
			if err = os.Remove(filepath.Join(a.Config.UploadDir, c.SourceKey)); err != nil && !os.IsNotExist(err) {
				return
			}
		}
		if err = os.RemoveAll(filepath.Join(a.Config.MediaDir, "videos", c.VideoID)); err != nil {
			return
		}
	}
	_ = a.Store.MarkCleaned(ctx, c)
}

// Earlier Phase 2 ready jobs did not record output size. Measure their accepted directory before settling quota.
func (a *App) measureLegacyOutputs(ctx context.Context) {
	rows, err := a.Store.Pool.Query(ctx, `SELECT j.id,v.id,v.accepted_generation_id,v.accepted_attempt_id FROM catalog.processing_jobs j JOIN catalog.videos v ON v.id=j.video_id WHERE j.state='ready' AND j.output_bytes IS NULL AND v.deleted_at IS NULL AND v.processing_state='ready' LIMIT 30`)
	if err != nil {
		return
	}
	type output struct{ job, video, generation, attempt string }
	items := []output{}
	for rows.Next() {
		var o output
		if rows.Scan(&o.job, &o.video, &o.generation, &o.attempt) != nil {
			rows.Close()
			return
		}
		items = append(items, o)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return
	}
	for _, o := range items {
		var total int64
		root := filepath.Join(a.Config.MediaDir, "videos", o.video, o.generation, o.attempt)
		err := filepath.WalkDir(root, func(path string, entry os.DirEntry, e error) error {
			if e != nil {
				return e
			}
			if entry.IsDir() {
				return nil
			}
			info, e := entry.Info()
			if e != nil {
				return e
			}
			if !info.Mode().IsRegular() {
				return store.ErrUploadConflict
			}
			total += info.Size()
			return nil
		})
		if err == nil && total > 0 {
			_, _ = a.Store.Pool.Exec(ctx, `UPDATE catalog.processing_jobs SET output_bytes=$2 WHERE id=$1 AND state='ready' AND output_bytes IS NULL`, o.job, total)
		}
	}
}
