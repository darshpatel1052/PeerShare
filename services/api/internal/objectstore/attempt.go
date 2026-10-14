package objectstore

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/encoder"
)

func attemptBase(j encoder.Job) string {
	return fmt.Sprintf("videos/%s/%s/%s", j.VideoID, j.GenerationID, j.AttemptID)
}

// The descriptor is uploaded last: its existence never promises an incomplete
// set. The coordinator still downloads/hashes/validates the actual objects.
func (s *Remote) UploadAttempt(ctx context.Context, root string, j encoder.Job, result encoder.Result) error {
	base := attemptBase(j)
	names := make([]string, 0, len(result.Files))
	for name := range result.Files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if !ValidKey(name) {
			return errors.New("invalid output file key")
		}
		if err := s.PutFile(ctx, s.Processed, base+"/"+name, filepath.Join(root, filepath.FromSlash(base+"/"+name)), 16<<20); err != nil {
			return err
		}
	}
	return s.PutFile(ctx, s.Processed, base+"/output.json", filepath.Join(root, filepath.FromSlash(base+"/output.json")), 2<<20)
}

// Download into an isolated directory; callers remove it after validation.
func (s *Remote) DownloadAttempt(ctx context.Context, root string, j encoder.Job, key string) error {
	base := attemptBase(j)
	if key != base+"/output.json" {
		return errors.New("descriptor escaped assigned attempt")
	}
	data, err := s.Read(ctx, s.Processed, key, 2<<20)
	if err != nil {
		return err
	}
	var output encoder.Output
	if json.Unmarshal(data, &output) != nil || output.VideoID != j.VideoID || output.GenerationID != j.GenerationID || output.AttemptID != j.AttemptID || len(output.Files) < 5 || len(output.Files) > 5000 {
		return errors.New("invalid output descriptor")
	}
	if err = os.MkdirAll(filepath.Join(root, filepath.FromSlash(base)), 0700); err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(root, filepath.FromSlash(key)), data, 0600); err != nil {
		return err
	}
	total := int64(len(data))
	for name, file := range output.Files {
		if !ValidKey(name) || strings.HasPrefix(name, "output.json") || file.Bytes < 1 || file.Bytes > 16<<20 || total+file.Bytes > encoder.MaxOutputBytes {
			return errors.New("output exceeds download policy")
		}
		data, err = s.Read(ctx, s.Processed, base+"/"+name, file.Bytes)
		if err != nil {
			return err
		}
		hash := sha256.Sum256(data)
		if int64(len(data)) != file.Bytes || hex.EncodeToString(hash[:]) != file.SHA256 {
			return errors.New("remote output checksum mismatch")
		}
		total += file.Bytes
		filePath := filepath.Join(root, filepath.FromSlash(base+"/"+name))
		if err = os.MkdirAll(filepath.Dir(filePath), 0700); err != nil {
			return err
		}
		if err = os.WriteFile(filePath, data, 0600); err != nil {
			return err
		}
	}
	return nil
}
