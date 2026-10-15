package encoder

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestQualitiesNeverUpscale(t *testing.T) {
	for _, c := range []struct {
		height int
		want   []int
	}{{143, nil}, {145, []int{144}}, {360, []int{360}}, {479, []int{478}}, {480, []int{480}}, {481, []int{480}}, {640, []int{480, 640}}, {720, []int{480, 720}}, {1080, []int{480, 720}}} {
		if got := Qualities(c.height); !reflect.DeepEqual(got, c.want) {
			t.Errorf("source %d: got %v want %v", c.height, got, c.want)
		}
	}
}
func TestStoragePathRejectsTraversalAndSymlinks(t *testing.T) {
	root := t.TempDir()
	for _, key := range []string{"", "../outside", "/absolute", "videos/../outside", "videos\\outside"} {
		if _, err := safePath(root, key); err == nil {
			t.Errorf("accepted invalid key %q", key)
		}
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if _, err := safePath(root, "link/file"); err == nil {
		t.Fatal("symlink accepted")
	}
}
func TestIntegrationAdaptiveMediaAndDescriptorValidation(t *testing.T) {
	if os.Getenv("PEERSCREEN_INTEGRATION") != "true" {
		t.Skip("run the real media integration suite")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	uploads, media := t.TempDir(), t.TempDir()
	video := uuid.NewString()
	key := "sources/" + video + ".mp4"
	if err := os.Mkdir(filepath.Join(uploads, "sources"), 0755); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(uploads, key)
	cmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000", "-t", "9", "-c:v", "libx264", "-threads", "2", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", source)
	if err := cmd.Run(); err != nil {
		t.Fatal("could not generate real 720p source", err)
	}
	data, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(data)
	job := Job{ID: uuid.NewString(), VideoID: video, GenerationID: uuid.NewString(), AttemptID: uuid.NewString(), SourceKey: key, SourceBytes: int64(len(data)), SourceHash: hash[:]}
	result, err := Process(ctx, job, uploads, media, func(string, int) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(result.Qualities, []int{480, 720}) {
		t.Fatal("expected actual adaptive renditions", result.Qualities)
	}
	if _, err = ValidateOutput(ctx, job, media, result.DescriptorKey); err != nil {
		t.Fatal("valid output rejected", err)
	}
	base := filepath.Dir(filepath.Join(media, result.DescriptorKey))
	for _, quality := range result.Qualities {
		path := filepath.Join(base, fmt.Sprintf("%dp/index.m3u8", quality))
		decode := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,crypto,data", "-i", path, "-f", "null", "-")
		if err = decode.Run(); err != nil {
			t.Fatalf("%dp did not decode: %v", quality, err)
		}
	}
	descriptorPath := filepath.Join(media, result.DescriptorKey)
	original, err := os.ReadFile(descriptorPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Run("wrong-attempt", func(t *testing.T) {
		other := job
		other.AttemptID = uuid.NewString()
		if _, e := ValidateOutput(ctx, other, media, result.DescriptorKey); e == nil {
			t.Fatal("another attempt's output accepted")
		}
	})
	t.Run("missing-playlist", func(t *testing.T) {
		path := filepath.Join(base, "480p/index.m3u8")
		backup, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		if e = os.Remove(path); e != nil {
			t.Fatal(e)
		}
		defer os.WriteFile(path, backup, 0644)
		if _, e = ValidateOutput(ctx, job, media, result.DescriptorKey); e == nil {
			t.Fatal("partial output accepted")
		}
	})
	t.Run("corrupt-segment", func(t *testing.T) {
		path := filepath.Join(base, "720p/segment-000.ts")
		backup, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		changed := append([]byte{}, backup...)
		changed[0] ^= 1
		if e = os.WriteFile(path, changed, 0644); e != nil {
			t.Fatal(e)
		}
		defer os.WriteFile(path, backup, 0644)
		if _, e = ValidateOutput(ctx, job, media, result.DescriptorKey); e == nil {
			t.Fatal("corrupted output accepted")
		}
	})
	t.Run("descriptor-traversal", func(t *testing.T) {
		changed := result.Output
		changed.Files = map[string]File{}
		for k, v := range result.Files {
			changed.Files[k] = v
		}
		changed.Files["../outside"] = File{SHA256: "bad", Bytes: 1}
		payload, _ := json.Marshal(changed)
		if e := os.WriteFile(descriptorPath, payload, 0644); e != nil {
			t.Fatal(e)
		}
		defer os.WriteFile(descriptorPath, original, 0644)
		if _, e := ValidateOutput(ctx, job, media, result.DescriptorKey); e == nil {
			t.Fatal("traversal accepted")
		}
	})
}

// Stop an actual child process during both source probing and encoding. The
// same valid input must remain retryable after either interruption.
func TestInterruptedMediaSubprocessDoesNotRejectSource(t *testing.T) {
	for _, stage := range []string{"probe", "encode"} {
		t.Run(stage, func(t *testing.T) {
			bin, root, media := t.TempDir(), t.TempDir(), t.TempDir()
			marker := filepath.Join(bin, "started")
			block := "#!/bin/sh\nprintf started > \"$TEST_PROCESS_MARKER\"\nexec /bin/sleep 60\n"
			probe := "#!/bin/sh\nprintf '%s' '{\"format\":{\"duration\":\"3\",\"format_name\":\"mov,mp4\"},\"streams\":[{\"codec_type\":\"video\",\"width\":1280,\"height\":720}]}'\n"
			if stage == "probe" {
				probe = block
			}
			for name, script := range map[string]string{"ffprobe": probe, "ffmpeg": block} {
				if err := os.WriteFile(filepath.Join(bin, name), []byte(script), 0755); err != nil {
					t.Fatal(err)
				}
			}
			t.Setenv("PATH", bin)
			t.Setenv("TEST_PROCESS_MARKER", marker)
			source := []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0, 'i', 's', 'o', 'm', 0, 0, 0, 0}
			if err := os.WriteFile(filepath.Join(root, "source.mp4"), source, 0600); err != nil {
				t.Fatal(err)
			}
			hash := sha256.Sum256(source)
			job := Job{ID: uuid.NewString(), VideoID: uuid.NewString(), GenerationID: uuid.NewString(), AttemptID: uuid.NewString(), SourceKey: "source.mp4", SourceBytes: int64(len(source)), SourceHash: hash[:]}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			done := make(chan error, 1)
			go func() { _, err := Process(ctx, job, root, media, func(string, int) error { return nil }); done <- err }()
			for {
				if _, err := os.Stat(marker); err == nil {
					break
				}
				if ctx.Err() != nil {
					t.Fatal("media subprocess never started")
				}
				time.Sleep(5 * time.Millisecond)
			}
			cancel()
			var failure *Failure
			if err := <-done; !errors.As(err, &failure) || failure.Permanent || !errors.Is(err, context.Canceled) {
				t.Fatalf("%s cancellation incorrectly classified: %v", stage, err)
			}
		})
	}
}
