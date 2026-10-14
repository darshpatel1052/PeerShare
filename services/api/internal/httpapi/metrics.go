package httpapi

import (
	"fmt"
	"net/http"
	"runtime"
	"strconv"
	"sync"
)

var latencyBounds = [...]float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 120}

type metricKey struct{ method, route, status string }
type requestMetric struct {
	count   uint64
	seconds float64
	buckets [13]uint64
}
type requestMetrics struct {
	sync.Mutex
	items map[metricKey]*requestMetric
}

func (m *requestMetrics) observe(method, route string, status int, seconds float64) {
	switch method {
	case "GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS":
	default:
		method = "OTHER"
	}
	if route == "" {
		route = "unmatched"
	}
	key := metricKey{method, route, strconv.Itoa(status/100) + "xx"}
	m.Lock()
	defer m.Unlock()
	if m.items == nil {
		m.items = make(map[metricKey]*requestMetric)
	}
	item := m.items[key]
	if item == nil {
		item = &requestMetric{}
		m.items[key] = item
	}
	item.count++
	item.seconds += seconds
	for index, bound := range latencyBounds {
		if seconds <= bound {
			item.buckets[index]++
		}
	}
}
func (a *App) operationalMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	stats := a.Store.Pool.Stat()
	if a.analytics != nil {
		fmt.Fprintf(w, "# TYPE peerscreen_analytics_cache_total counter\npeerscreen_analytics_cache_total{result=\"hit\"} %d\npeerscreen_analytics_cache_total{result=\"miss\"} %d\npeerscreen_analytics_cache_total{result=\"error\"} %d\npeerscreen_analytics_cache_total{result=\"bypass\"} %d\n", a.analytics.hits.Load(), a.analytics.misses.Load(), a.analytics.errors.Load(), a.analytics.bypasses.Load())
	}
	fmt.Fprintf(w, "peerscreen_go_goroutines %d\npeerscreen_go_heap_bytes %d\npeerscreen_db_connections %d\npeerscreen_db_acquired_connections %d\npeerscreen_db_max_connections %d\n", runtime.NumGoroutine(), memory.HeapAlloc, stats.TotalConns(), stats.AcquiredConns(), stats.MaxConns())
	a.metrics.Lock()
	defer a.metrics.Unlock()
	fmt.Fprintln(w, "# TYPE peerscreen_http_request_duration_seconds histogram")
	for key, item := range a.metrics.items {
		labels := fmt.Sprintf("method=%s,route=%s,status_class=%s", strconv.Quote(key.method), strconv.Quote(key.route), strconv.Quote(key.status))
		for index, bound := range latencyBounds {
			fmt.Fprintf(w, "peerscreen_http_request_duration_seconds_bucket{%s,le=%q} %d\n", labels, strconv.FormatFloat(bound, 'g', -1, 64), item.buckets[index])
		}
		fmt.Fprintf(w, "peerscreen_http_request_duration_seconds_bucket{%s,le=\"+Inf\"} %d\npeerscreen_http_request_duration_seconds_count{%s} %d\npeerscreen_http_request_duration_seconds_sum{%s} %g\n", labels, item.count, labels, item.count, labels, item.seconds)
	}
}
