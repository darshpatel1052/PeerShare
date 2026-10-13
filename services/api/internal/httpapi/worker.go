package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
	"github.com/google/uuid"
)

type boundedOutput struct {
	data []byte
	max  int
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	n := len(p)
	if len(b.data) < b.max {
		remain := b.max - len(b.data)
		if remain > n {
			remain = n
		}
		b.data = append(b.data, p[:remain]...)
	}
	return n, nil
}

type probeResult struct {
	Format struct {
		Duration   string `json:"duration"`
		FormatName string `json:"format_name"`
	} `json:"format"`
	Streams []struct {
		CodecType string `json:"codec_type"`
		Width     int    `json:"width"`
		Height    int    `json:"height"`
	} `json:"streams"`
}
type segmentIntegrity struct {
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
}

// RunMediaWorker is a bounded executor; PostgreSQL owns queue state and the single global slot.
func (a *App) RunMediaWorker(ctx context.Context) {
	workerID := uuid.NewString()
	maintenanceDone := make(chan struct{})
	go func() {
		defer close(maintenanceDone)
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			a.reconcileMedia(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	defer func() { <-maintenanceDone }()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			job, err := a.Store.ClaimJob(ctx, workerID)
			if err != nil {
				if ctx.Err() == nil {
					a.Logger.Error("media_job_claim_failed", "reason", err.Error())
				}
				continue
			}
			if job.ID == "" {
				continue
			}
			if err = a.processMediaJob(ctx, job); err != nil && ctx.Err() == nil {
				a.Logger.Warn("media_job_stopped", "video_id", job.VideoID, "attempt_id", job.AttemptID, "reason", err.Error())
			}
		}
	}
}
func cleanupContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 3*time.Second)
}

func (a *App) processMediaJob(parent context.Context, job store.Job) error {
	videoID, sourceKey := job.VideoID, job.SourceKey
	ctx, cancel := context.WithTimeout(parent, 30*time.Minute)
	defer cancel()
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := a.Store.HeartbeatJob(ctx, job); err != nil {
					cancel()
					return
				}
			}
		}
	}()
	defer func() { cancel(); <-heartbeatDone }()
	fail := func(code string, cause error) error {
		dbctx, stop := cleanupContext()
		defer stop()
		if parent.Err() != nil {
			_ = a.Store.ReleaseJob(dbctx, job)
			return cause
		}
		_ = a.Store.FinishProcessing(dbctx, job, "", "", "", 0, nil, 0, code)
		return cause
	}

	source := filepath.Join(a.Config.UploadDir, filepath.FromSlash(sourceKey))
	info, err := os.Stat(source)
	if err != nil || !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > store.MaxSourceBytes || info.Size() != job.SourceBytes {
		return fail("source_unavailable", errors.New("source file is unavailable or outside the size policy"))
	}
	if err = a.Store.ProcessingProgress(ctx, job, "validating", 5); err != nil {
		return fail("dependency_unavailable", err)
	}
	// Verify the assembled content again before parsing/encoding; a source path alone is not an identity.
	sourceFile, err := os.Open(source)
	if err != nil {
		return fail("source_unavailable", err)
	}
	contentHash := sha256.New()
	_, err = io.Copy(contentHash, sourceFile)
	sourceFile.Close()
	if err != nil || len(job.SourceHash) > 0 && !bytes.Equal(contentHash.Sum(nil), job.SourceHash) {
		return fail("source_corrupt", errors.New("source checksum failed"))
	}
	probe, err := probeMedia(ctx, source)
	if err != nil {
		return fail("unsupported_media", err)
	}
	duration, err := strconv.ParseFloat(probe.Format.Duration, 64)
	if err != nil || math.IsNaN(duration) || math.IsInf(duration, 0) || duration <= 0 || duration > 600 {
		return fail("unsupported_media", errors.New("video duration must be between 0 and 10 minutes"))
	}
	width, height := 0, 0
	for _, stream := range probe.Streams {
		if stream.CodecType == "video" && stream.Width > width && stream.Height > 0 {
			width, height = stream.Width, stream.Height
			break
		}
	}
	if width < 64 || height < 144 || width > 3840 || height > 2160 || len(probe.Streams) > 8 {
		return fail("unsupported_media", errors.New("a video stream with usable dimensions is required"))
	}
	quality := height / 2 * 2
	if quality > 480 {
		quality = 480
	}
	if quality < 144 {
		return fail("unsupported_media", errors.New("video height must be at least 144 pixels"))
	}
	generation, attempt := job.GenerationID, job.AttemptID
	rel := filepath.Join("videos", videoID, generation, attempt)
	outDir := filepath.Join(a.Config.MediaDir, rel)
	defer func() {
		dbctx, stop := cleanupContext()
		defer stop()
		referenced, err := a.Store.AttemptReferenced(dbctx, attempt)
		if err == nil && !referenced {
			_ = os.RemoveAll(outDir)
		}
	}()
	renditionDir := filepath.Join(outDir, fmt.Sprintf("%dp", quality))
	if err = os.MkdirAll(renditionDir, 0755); err != nil {
		return fail("storage_unavailable", err)
	}
	if err = a.Store.ProcessingProgress(ctx, job, "encoding", 15); err != nil {
		return fail("dependency_unavailable", err)
	}
	segmentPattern := filepath.Join(renditionDir, "segment-%03d.ts")
	playlist := filepath.Join(renditionDir, "index.m3u8")
	filter := fmt.Sprintf("scale=-2:min(%d\\,ih):force_divisible_by=2", quality)
	args := []string{"-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-f", "mov", "-enable_drefs", "0", "-use_absolute_path", "0", "-i", source, "-map", "0:v:0", "-map", "0:a:0?", "-vf", filter, "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", "-r", "30", "-force_key_frames", "expr:gte(t,n_forced*4)", "-maxrate", "1800k", "-bufsize", "3600k", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-f", "hls", "-hls_time", "4", "-hls_flags", "independent_segments", "-hls_playlist_type", "vod", "-hls_segment_filename", segmentPattern, playlist}
	if err = runBounded(ctx, "ffmpeg", args...); err != nil {
		_ = os.RemoveAll(outDir)
		return fail("processing_failed", err)
	}
	if err = a.Store.ProcessingProgress(ctx, job, "thumbnail", 75); err != nil {
		return fail("dependency_unavailable", err)
	}
	thumb := filepath.Join(outDir, "thumbnail.jpg")
	if err = runBounded(ctx, "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-ss", "0", "-f", "mov", "-enable_drefs", "0", "-use_absolute_path", "0", "-i", source, "-frames:v", "1", "-vf", "scale=640:-2", "-y", thumb); err != nil {
		_ = os.RemoveAll(outDir)
		return fail("processing_failed", err)
	}
	if err = a.Store.ProcessingProgress(ctx, job, "indexing", 88); err != nil {
		return fail("dependency_unavailable", err)
	}
	segments, err := filepath.Glob(filepath.Join(renditionDir, "segment-*.ts"))
	if err != nil || len(segments) == 0 || len(segments) > 5000 {
		_ = os.RemoveAll(outDir)
		return fail("processing_failed", errors.New("transcoder did not produce a valid segment set"))
	}
	sort.Strings(segments)
	entries := map[string]segmentIntegrity{}
	versionHash := sha256.New()
	for _, name := range segments {
		f, openErr := os.Open(name)
		if openErr != nil {
			return fail("storage_unavailable", openErr)
		}
		h := sha256.New()
		n, copyErr := io.Copy(io.MultiWriter(h, versionHash), f)
		f.Close()
		if copyErr != nil {
			return fail("storage_unavailable", copyErr)
		}
		key := fmt.Sprintf("%dp/%s", quality, filepath.Base(name))
		entries[key] = segmentIntegrity{SHA256: hex.EncodeToString(h.Sum(nil)), Bytes: n}
	}
	mediaVersion := hex.EncodeToString(versionHash.Sum(nil))
	descriptor := struct {
		SchemaVersion int                         `json:"schemaVersion"`
		MediaVersion  string                      `json:"mediaVersion"`
		Segments      map[string]segmentIntegrity `json:"segments"`
	}{1, mediaVersion, entries}
	descriptorBytes, err := json.Marshal(descriptor)
	if err != nil {
		return fail("processing_failed", err)
	}
	manifest := filepath.Join(outDir, "master.m3u8")
	var encoded probeResult
	encodedBytes := &boundedOutput{max: 1024 * 1024}
	encodedProbe := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "stream=codec_type,width,height", "-of", "json", segments[0])
	encodedProbe.Stdout = encodedBytes
	encodedProbe.Stderr = io.Discard
	if e := encodedProbe.Run(); e != nil {
		return fail("processing_failed", e)
	}
	if e := json.Unmarshal(encodedBytes.data, &encoded); e != nil {
		return fail("processing_failed", e)
	}
	encodedWidth, encodedHeight := 0, 0
	for _, stream := range encoded.Streams {
		if stream.CodecType == "video" {
			encodedWidth, encodedHeight = stream.Width, stream.Height
			break
		}
	}
	if encodedWidth < 1 || encodedHeight != quality {
		return fail("processing_failed", errors.New("encoded rendition dimensions did not match the recipe"))
	}
	master := fmt.Sprintf("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=2128000,RESOLUTION=%dx%d\n%dp/index.m3u8\n", encodedWidth, encodedHeight, quality)
	if err = os.WriteFile(manifest, []byte(master), 0644); err != nil {
		return fail("storage_unavailable", err)
	}
	if err = os.WriteFile(filepath.Join(outDir, "integrity.json"), descriptorBytes, 0644); err != nil {
		return fail("storage_unavailable", err)
	}
	base := filepath.ToSlash(rel)
	manifestKey := base + "/master.m3u8"
	integrityKey := base + "/integrity.json"
	thumbnailKey := base + "/thumbnail.jpg"
	var outputBytes int64
	if err = filepath.WalkDir(outDir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		info, e := entry.Info()
		if e != nil {
			return e
		}
		outputBytes += info.Size()
		if outputBytes > store.MaxOutputBytes {
			return store.ErrUploadLimit
		}
		f, e := os.OpenFile(path, os.O_RDWR, 0)
		if e != nil {
			return e
		}
		e = f.Sync()
		f.Close()
		return e
	}); err != nil {
		return fail("output_too_large", err)
	}
	if err = syncDirectory(renditionDir); err != nil {
		return fail("storage_unavailable", err)
	}
	if err = syncDirectory(outDir); err != nil {
		return fail("storage_unavailable", err)
	}
	if err = a.Store.FinishProcessing(ctx, job, manifestKey, integrityKey, thumbnailKey, int(math.Ceil(duration)), []int{quality}, outputBytes, ""); err != nil {
		return fail("dependency_unavailable", err)
	}
	return nil
}

func probeMedia(ctx context.Context, source string) (probeResult, error) {
	var result probeResult
	// The ISO BMFF ftyp box and the MOV demuxer must agree; a filename is never validation.
	f, err := os.Open(source)
	if err != nil {
		return result, err
	}
	header := make([]byte, 16)
	_, err = io.ReadFull(f, header)
	f.Close()
	if err != nil || string(header[4:8]) != "ftyp" || binary.BigEndian.Uint32(header[:4]) < 16 || string(header[8:12]) == "qt  " || strings.HasPrefix(string(header[8:12]), "3g") {
		return result, errors.New("the source must be an MP4 container")
	}
	out := &boundedOutput{max: 1024 * 1024}
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov", "-enable_drefs", "0", "-use_absolute_path", "0", "-show_entries", "format=duration,format_name:stream=codec_type,width,height", "-of", "json", source)
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return result, errors.New("FFprobe could not read a supported video")
	}
	if err := json.Unmarshal(out.data, &result); err != nil {
		return result, errors.New("FFprobe returned invalid media details")
	}
	hasVideo := false
	for _, stream := range result.Streams {
		hasVideo = hasVideo || stream.CodecType == "video"
	}
	if !hasVideo || !strings.Contains(result.Format.FormatName, "mp4") {
		return result, errors.New("the uploaded file contains no video stream")
	}
	return result, nil
}

func runBounded(ctx context.Context, binary string, args ...string) error {
	out := &boundedOutput{max: 64 * 1024}
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Stdout = io.Discard
	cmd.Stderr = out
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		message := strings.TrimSpace(string(out.data))
		if len(message) > 300 {
			message = message[:300]
		}
		if message != "" {
			return fmt.Errorf("%s: %s", binary, message)
		}
		return fmt.Errorf("%s did not complete successfully", binary)
	}
	return nil
}
