// Package encoder performs bounded filesystem media work. It has no database, Kafka, or HTTP dependency.
package encoder

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
	"syscall"
	"time"
)

const RecipeVersion = "h264-aac-hls-v2"
const MaxSourceBytes int64 = 250 * 1024 * 1024
const MaxOutputBytes int64 = 220 * 1024 * 1024

type Job struct {
	ID, VideoID, GenerationID, AttemptID, SourceKey string
	SourceBytes                                     int64
	SourceHash                                      []byte
}
type File struct {
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
}
type Output struct {
	SchemaVersion   int             `json:"schema_version"`
	RecipeVersion   string          `json:"recipe_version"`
	JobID           string          `json:"job_id"`
	VideoID         string          `json:"video_id"`
	GenerationID    string          `json:"generation_id"`
	AttemptID       string          `json:"attempt_id"`
	ManifestKey     string          `json:"manifest_key"`
	IntegrityKey    string          `json:"integrity_key"`
	ThumbnailKey    string          `json:"thumbnail_key"`
	DurationSeconds int             `json:"duration_seconds"`
	Qualities       []int           `json:"qualities"`
	Files           map[string]File `json:"files"`
}
type Result struct {
	Output
	DescriptorKey string
	Bytes         int64
}
type Failure struct {
	Code      string
	Permanent bool
	Cause     error
}

func (f *Failure) Error() string                             { return f.Code }
func (f *Failure) Unwrap() error                             { return f.Cause }
func failure(code string, permanent bool, cause error) error { return &Failure{code, permanent, cause} }

type boundedOutput struct {
	data []byte
	max  int
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	n := len(p)
	if len(b.data) < b.max {
		keep := min(n, b.max-len(b.data))
		b.data = append(b.data, p[:keep]...)
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

// Qualities never upscale a smaller source and retain a useful source-sized top rendition.
func Qualities(height int) []int {
	height = height / 2 * 2
	if height < 144 {
		return nil
	}
	if height > 720 {
		height = 720
	}
	if height > 480 {
		return []int{480, height}
	}
	return []int{height}
}
func Process(ctx context.Context, j Job, uploadRoot, mediaRoot string, progress func(string, int) error) (Result, error) {
	var result Result
	source, err := safePath(uploadRoot, j.SourceKey)
	if err != nil {
		return result, failure("source_unavailable", true, err)
	}
	info, err := os.Lstat(source)
	if err != nil || !info.Mode().IsRegular() || info.Size() != j.SourceBytes || info.Size() < 1 || info.Size() > MaxSourceBytes {
		return result, failure("source_unavailable", false, errors.New("source size or file type is invalid"))
	}
	if err = progress("validating", 5); err != nil {
		return result, err
	}
	digest, err := hashFile(ctx, source)
	if err != nil {
		return result, failure("storage_unavailable", false, err)
	}
	if len(j.SourceHash) != 32 || digest.SHA256 != hex.EncodeToString(j.SourceHash) {
		return result, failure("source_corrupt", true, errors.New("source checksum mismatch"))
	}
	probe, err := probeMedia(ctx, source)
	if err != nil {
		return result, failure("unsupported_media", true, err)
	}
	duration, err := strconv.ParseFloat(probe.Format.Duration, 64)
	if err != nil || math.IsNaN(duration) || math.IsInf(duration, 0) || duration <= 0 || duration > 600 {
		return result, failure("unsupported_media", true, errors.New("duration outside policy"))
	}
	width, height := 0, 0
	for _, s := range probe.Streams {
		if s.CodecType == "video" {
			width, height = s.Width, s.Height
			break
		}
	}
	qualities := Qualities(height)
	if width < 64 || height < 144 || width > 3840 || height > 2160 || len(probe.Streams) > 8 || len(qualities) == 0 {
		return result, failure("unsupported_media", true, errors.New("dimensions outside policy"))
	}
	base := fmt.Sprintf("videos/%s/%s/%s", j.VideoID, j.GenerationID, j.AttemptID)
	outDir, err := safePath(mediaRoot, base)
	if err != nil {
		return result, err
	}
	if err = os.MkdirAll(outDir, 0755); err != nil {
		return result, failure("storage_unavailable", false, err)
	}
	success := false
	defer func() {
		if !success {
			_ = os.RemoveAll(outDir)
		}
	}()
	master := "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-INDEPENDENT-SEGMENTS\n"
	for index, quality := range qualities {
		rendition := filepath.Join(outDir, fmt.Sprintf("%dp", quality))
		if err = os.MkdirAll(rendition, 0755); err != nil {
			return result, failure("storage_unavailable", false, err)
		}
		if err = progress("encoding", 15+index*25); err != nil {
			return result, err
		}
		rate, bandwidth := 900, 1200000
		if quality > 480 {
			rate, bandwidth = 1800, 2250000
		}
		args := []string{"-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-f", "mov", "-enable_drefs", "0", "-use_absolute_path", "0", "-i", source, "-map", "0:v:0", "-map", "0:a:0?", "-vf", fmt.Sprintf("scale=-2:%d:force_divisible_by=2", quality), "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", "-r", "30", "-force_key_frames", "expr:gte(t,n_forced*4)", "-maxrate", fmt.Sprintf("%dk", rate), "-bufsize", fmt.Sprintf("%dk", rate*2), "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "96k", "-f", "hls", "-hls_time", "4", "-hls_flags", "independent_segments", "-hls_playlist_type", "vod", "-hls_segment_filename", filepath.Join(rendition, "segment-%03d.ts"), filepath.Join(rendition, "index.m3u8")}
		if err = runBounded(ctx, "ffmpeg", args...); err != nil {
			return result, failure("processing_failed", true, err)
		}
		segments, e := filepath.Glob(filepath.Join(rendition, "segment-*.ts"))
		if e != nil || len(segments) == 0 || len(segments) > 5000 {
			return result, failure("processing_failed", true, errors.New("missing segment set"))
		}
		sort.Strings(segments)
		encoded, e := probeSegment(ctx, segments[0])
		if e != nil {
			return result, failure("processing_failed", true, e)
		}
		encodedWidth, encodedHeight := 0, 0
		for _, s := range encoded.Streams {
			if s.CodecType == "video" {
				encodedWidth, encodedHeight = s.Width, s.Height
				break
			}
		}
		if encodedWidth < 1 || encodedHeight != quality {
			return result, failure("processing_failed", true, errors.New("rendition dimensions mismatch"))
		}
		master += fmt.Sprintf("#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d\n%dp/index.m3u8\n", bandwidth, encodedWidth, encodedHeight, quality)
	}
	if err = progress("thumbnail", 75); err != nil {
		return result, err
	}
	if err = runBounded(ctx, "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-ss", "0", "-f", "mov", "-enable_drefs", "0", "-use_absolute_path", "0", "-i", source, "-frames:v", "1", "-vf", "scale=min(640\\,iw):-2", "-y", filepath.Join(outDir, "thumbnail.jpg")); err != nil {
		return result, failure("processing_failed", true, err)
	}
	if err = progress("indexing", 88); err != nil {
		return result, err
	}
	if err = os.WriteFile(filepath.Join(outDir, "master.m3u8"), []byte(master), 0644); err != nil {
		return result, failure("storage_unavailable", false, err)
	}
	segments := map[string]File{}
	version := sha256.New()
	_, _ = version.Write([]byte(RecipeVersion + ":" + j.GenerationID + ":" + j.AttemptID))
	names, err := filepath.Glob(filepath.Join(outDir, "*p", "segment-*.ts"))
	if err != nil {
		return result, err
	}
	sort.Strings(names)
	for _, name := range names {
		entry, e := hashFile(ctx, name)
		if e != nil {
			return result, failure("storage_unavailable", false, e)
		}
		key, _ := filepath.Rel(outDir, name)
		segments[filepath.ToSlash(key)] = entry
		_, _ = fmt.Fprintf(version, "%s:%s:%d\n", filepath.ToSlash(key), entry.SHA256, entry.Bytes)
	}
	integrity := struct {
		SchemaVersion int             `json:"schemaVersion"`
		MediaVersion  string          `json:"mediaVersion"`
		Segments      map[string]File `json:"segments"`
	}{1, hex.EncodeToString(version.Sum(nil)), segments}
	integrityBytes, _ := json.Marshal(integrity)
	if err = os.WriteFile(filepath.Join(outDir, "integrity.json"), integrityBytes, 0644); err != nil {
		return result, failure("storage_unavailable", false, err)
	}
	output := Output{SchemaVersion: 1, RecipeVersion: RecipeVersion, JobID: j.ID, VideoID: j.VideoID, GenerationID: j.GenerationID, AttemptID: j.AttemptID, ManifestKey: base + "/master.m3u8", IntegrityKey: base + "/integrity.json", ThumbnailKey: base + "/thumbnail.jpg", DurationSeconds: int(math.Ceil(duration)), Qualities: qualities, Files: map[string]File{}}
	var total int64
	err = filepath.WalkDir(outDir, func(path string, entry os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return errors.New("output contains a nonregular file")
		}
		f, e := hashFile(ctx, path)
		if e != nil {
			return e
		}
		key, _ := filepath.Rel(outDir, path)
		output.Files[filepath.ToSlash(key)] = f
		total += f.Bytes
		if total > MaxOutputBytes {
			return errors.New("output size outside policy")
		}
		handle, e := os.OpenFile(path, os.O_RDWR, 0)
		if e != nil {
			return e
		}
		e = handle.Sync()
		handle.Close()
		return e
	})
	if err != nil {
		return result, failure("output_too_large", true, err)
	}
	descriptorBytes, _ := json.Marshal(output)
	total += int64(len(descriptorBytes))
	if total > MaxOutputBytes {
		return result, failure("output_too_large", true, errors.New("descriptor exceeds output budget"))
	}
	descriptor := filepath.Join(outDir, "output.json")
	if err = os.WriteFile(descriptor, descriptorBytes, 0644); err != nil {
		return result, failure("storage_unavailable", false, err)
	}
	handle, err := os.OpenFile(descriptor, os.O_RDWR, 0)
	if err != nil {
		return result, err
	}
	err = handle.Sync()
	handle.Close()
	if err != nil {
		return result, err
	}
	for _, quality := range qualities {
		if err = SyncDirectory(filepath.Join(outDir, fmt.Sprintf("%dp", quality))); err != nil {
			return result, err
		}
	}
	for _, path := range []string{outDir, filepath.Dir(outDir), filepath.Dir(filepath.Dir(outDir)), filepath.Join(mediaRoot, "videos"), mediaRoot} {
		if err = SyncDirectory(path); err != nil {
			return result, err
		}
	}
	success = true
	return Result{output, base + "/output.json", total}, nil
}

func safePath(root, key string) (string, error) {
	if key == "" || strings.Contains(key, "\\") || filepath.IsAbs(key) || filepath.ToSlash(filepath.Clean(key)) != key || key == ".." || strings.HasPrefix(key, "../") {
		return "", errors.New("invalid storage key")
	}
	path := filepath.Join(root, filepath.FromSlash(key))
	absolute, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	current := absolute
	for _, part := range strings.Split(key, "/") {
		current = filepath.Join(current, part)
		info, e := os.Lstat(current)
		if e == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("symlink storage path rejected")
		}
		if e != nil && !os.IsNotExist(e) {
			return "", e
		}
	}
	return path, nil
}
func hashFile(ctx context.Context, path string) (File, error) {
	f, err := os.Open(path)
	if err != nil {
		return File{}, err
	}
	defer f.Close()
	h := sha256.New()
	buffer := make([]byte, 64*1024)
	var total int64
	for {
		if err = ctx.Err(); err != nil {
			return File{}, err
		}
		n, e := f.Read(buffer)
		total += int64(n)
		if total > MaxOutputBytes && strings.HasSuffix(path, ".ts") {
			return File{}, errors.New("segment too large")
		}
		if n > 0 {
			_, _ = h.Write(buffer[:n])
		}
		if e == io.EOF {
			break
		}
		if e != nil {
			return File{}, e
		}
	}
	return File{hex.EncodeToString(h.Sum(nil)), total}, nil
}
func probeMedia(ctx context.Context, source string) (probeResult, error) {
	var result probeResult
	f, err := os.Open(source)
	if err != nil {
		return result, err
	}
	header := make([]byte, 16)
	_, err = io.ReadFull(f, header)
	f.Close()
	if err != nil || string(header[4:8]) != "ftyp" || binary.BigEndian.Uint32(header[:4]) < 16 || string(header[8:12]) == "qt  " || strings.HasPrefix(string(header[8:12]), "3g") {
		return result, errors.New("source must be MP4")
	}
	out := &boundedOutput{max: 1024 * 1024}
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov", "-enable_drefs", "0", "-use_absolute_path", "0", "-show_entries", "format=duration,format_name:stream=codec_type,width,height", "-of", "json", source)
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	if err = cmd.Run(); err != nil {
		return result, errors.New("unsupported source")
	}
	if err = json.Unmarshal(out.data, &result); err != nil {
		return result, err
	}
	if !strings.Contains(result.Format.FormatName, "mp4") {
		return result, errors.New("unsupported container")
	}
	return result, nil
}
func probeSegment(ctx context.Context, path string) (probeResult, error) {
	var result probeResult
	out := &boundedOutput{max: 1024 * 1024}
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "stream=codec_type,width,height", "-of", "json", path)
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return result, err
	}
	return result, json.Unmarshal(out.data, &result)
}
func runBounded(ctx context.Context, binary string, args ...string) error {
	out := &boundedOutput{max: 64 * 1024}
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Stdout = io.Discard
	cmd.Stderr = out
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return os.ErrProcessDone
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	cmd.WaitDelay = 3 * time.Second
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("media subprocess failed")
	}
	return nil
}
func SyncDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

// ValidateOutput independently checks the worker's whole descriptor before a coordinator may accept it.
func ValidateOutput(ctx context.Context, j Job, mediaRoot, key string) (Result, error) {
	var result Result
	base := fmt.Sprintf("videos/%s/%s/%s", j.VideoID, j.GenerationID, j.AttemptID)
	if key != base+"/output.json" {
		return result, errors.New("descriptor is outside the assigned attempt")
	}
	path, err := safePath(mediaRoot, key)
	if err != nil {
		return result, err
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 2*1024*1024 {
		return result, errors.New("descriptor unavailable or oversized")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return result, err
	}
	var output Output
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&output); err != nil {
		return result, err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return result, errors.New("multiple descriptor values")
	}
	if output.SchemaVersion != 1 || output.RecipeVersion != RecipeVersion || output.JobID != j.ID || output.VideoID != j.VideoID || output.GenerationID != j.GenerationID || output.AttemptID != j.AttemptID || output.DurationSeconds < 1 || output.DurationSeconds > 600 || len(output.Qualities) < 1 || len(output.Qualities) > 2 || len(output.Files) < 5 || len(output.Files) > 5000 || output.ManifestKey != base+"/master.m3u8" || output.IntegrityKey != base+"/integrity.json" || output.ThumbnailKey != base+"/thumbnail.jpg" {
		return result, errors.New("descriptor does not match job policy")
	}
	var total = int64(len(data))
	for name, expected := range output.Files {
		file, e := safePath(mediaRoot, base+"/"+name)
		if e != nil || name == "output.json" || expected.Bytes < 1 || expected.Bytes > 16*1024*1024 {
			return result, errors.New("invalid descriptor file")
		}
		info, e := os.Lstat(file)
		if e != nil || !info.Mode().IsRegular() || info.Size() != expected.Bytes {
			return result, errors.New("incomplete output")
		}
		actual, e := hashFile(ctx, file)
		if e != nil || actual != expected {
			return result, errors.New("output checksum mismatch")
		}
		total += actual.Bytes
		if total > MaxOutputBytes {
			return result, errors.New("output exceeds policy")
		}
	}
	for _, name := range []string{"master.m3u8", "integrity.json", "thumbnail.jpg"} {
		if _, exists := output.Files[name]; !exists {
			return result, errors.New("required output missing")
		}
	}
	integrityData, err := os.ReadFile(filepath.Join(mediaRoot, base, "integrity.json"))
	if err != nil {
		return result, err
	}
	var integrity struct {
		SchemaVersion int             `json:"schemaVersion"`
		MediaVersion  string          `json:"mediaVersion"`
		Segments      map[string]File `json:"segments"`
	}
	if json.Unmarshal(integrityData, &integrity) != nil || integrity.SchemaVersion != 1 || len(integrity.MediaVersion) != 64 {
		return result, errors.New("invalid integrity descriptor")
	}
	segments := 0
	for name, file := range output.Files {
		if strings.HasSuffix(name, ".ts") {
			segments++
			if integrity.Segments[name] != file {
				return result, errors.New("integrity coverage mismatch")
			}
		}
	}
	if segments == 0 || segments != len(integrity.Segments) {
		return result, errors.New("incomplete integrity coverage")
	}
	masterData, _ := os.ReadFile(filepath.Join(mediaRoot, base, "master.m3u8"))
	if !strings.HasPrefix(string(masterData), "#EXTM3U\n") {
		return result, errors.New("invalid master")
	}
	previous := 0
	for _, quality := range output.Qualities {
		if quality < 144 || quality > 720 || quality%2 != 0 || quality <= previous {
			return result, errors.New("invalid quality set")
		}
		previous = quality
		playlistKey := fmt.Sprintf("%dp/index.m3u8", quality)
		if _, ok := output.Files[playlistKey]; !ok || !strings.Contains(string(masterData), playlistKey+"\n") {
			return result, errors.New("rendition missing from master")
		}
		playlistData, e := os.ReadFile(filepath.Join(mediaRoot, base, playlistKey))
		if e != nil || !strings.HasPrefix(string(playlistData), "#EXTM3U\n") || !strings.Contains(string(playlistData), "#EXT-X-ENDLIST") {
			return result, errors.New("incomplete rendition playlist")
		}
		count := 0
		for _, line := range strings.Split(string(playlistData), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			name := fmt.Sprintf("%dp/%s", quality, line)
			if filepath.Base(line) != line || !strings.HasSuffix(line, ".ts") {
				return result, errors.New("invalid playlist segment")
			}
			if _, ok := integrity.Segments[name]; !ok {
				return result, errors.New("playlist references missing segment")
			}
			count++
		}
		if count == 0 {
			return result, errors.New("empty rendition")
		}
	}
	return Result{output, key, total}, nil
}
