package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/config"
)

func TestReadOnlyDeploymentRejectsWritesAndCountsResponseBytes(t *testing.T) {
	app := &App{Config: config.Config{ReadOnly: true, AppOrigin: "https://benchmark.example"}, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	calls := 0
	handler := app.requestScope(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		r.Pattern = "GET /api/v1/videos"
		_, _ = io.WriteString(w, "catalogue")
	}))
	write := httptest.NewRequest("POST", "https://benchmark.example/api/v1/uploads", strings.NewReader("{}"))
	write.Header.Set("Origin", app.Config.AppOrigin)
	rejected := httptest.NewRecorder()
	handler.ServeHTTP(rejected, write)
	if rejected.Code != 503 || calls != 0 {
		t.Fatal("read-only deployment executed a write")
	}
	read := httptest.NewRecorder()
	handler.ServeHTTP(read, httptest.NewRequest("GET", "https://benchmark.example/api/v1/videos", nil))
	if read.Code != 200 || calls != 1 {
		t.Fatal("read-only catalogue unavailable")
	}
	item := app.metrics.items[metricKey{"GET", "GET /api/v1/videos", "2xx"}]
	if item == nil || item.bytes != uint64(len("catalogue")) {
		t.Fatal("completed response body bytes were not recorded")
	}
}
