package store

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestCursorRoundTripPreservesTuple(t *testing.T) {
	video := Video{ID: "00000000-0000-4000-8000-000000000003", PublishedAt: time.Date(2026, 10, 13, 1, 2, 3, 123456000, time.UTC)}
	cursor, err := DecodeCursor(EncodeCursor(video))
	if err != nil || cursor.ID != video.ID || !cursor.PublishedAt.Equal(video.PublishedAt) {
		t.Fatal("timestamp and UUID tuple must round-trip")
	}
	cursor, err = DecodeCursor("")
	if cursor != nil || err != nil {
		t.Fatal("empty cursor must start the feed")
	}
}
func TestCursorRejectsMalformedAndUnboundedInput(t *testing.T) {
	valid := `{"published_at":"2026-10-13T00:00:00Z","id":"00000000-0000-4000-8000-000000000003"}`
	values := []string{strings.Repeat("a", 513), "not base64!", base64.RawURLEncoding.EncodeToString([]byte(`{}`)), base64.RawURLEncoding.EncodeToString([]byte(valid + ` {}`)), base64.RawURLEncoding.EncodeToString([]byte(valid + ` broken`)), base64.RawURLEncoding.EncodeToString([]byte(strings.Replace(valid, "00000000-0000-4000-8000-000000000003", "not-a-uuid", 1)))}
	for _, value := range values {
		if _, err := DecodeCursor(value); err == nil {
			t.Fatal("malformed cursor accepted")
		}
	}
}
