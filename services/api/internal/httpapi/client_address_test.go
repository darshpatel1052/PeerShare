package httpapi

import (
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
)

func TestClientAddressTrustsOnlyConfiguredGateway(t *testing.T) {
	a := &App{}
	a.Config.TrustedProxies = []netip.Prefix{netip.MustParsePrefix("172.29.241.10/32")}
	for _, sample := range []struct{ remote, header, want string }{
		{"192.0.2.1:1234", "198.51.100.2", "192.0.2.1"},
		{"172.29.241.10:1234", "198.51.100.2", "198.51.100.2"},
		{"172.29.241.10:1234", "198.51.100.2:44321", "198.51.100.2"},
		{"172.29.241.10:1234", "[2001:db8::10]:12345", "2001:db8::10"},
		{"192.0.2.1:1234", "198.51.100.2:44321", "192.0.2.1"},
		{"172.29.241.10:1234", "malformed", "172.29.241.10"},
		{"172.29.241.11:1234", "198.51.100.2", "172.29.241.11"},
	} {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = sample.remote
		r.Header.Set("X-PeerScreen-Client-IP", sample.header)
		if got := a.clientAddress(r); got != sample.want {
			t.Fatal("incorrect proxy trust boundary")
		}
	}
}
func TestIntegrationOperationalMetricsUseRoutePatterns(t *testing.T) {
	f := setup(t)
	c := client()
	id := "11111111-1111-4111-8111-111111111111"
	request(t, c, f.Server.URL, "GET", "/api/v1/videos/"+id, nil, nil)
	status, data, _ := request(t, c, f.Server.URL, "GET", "/metrics", nil, nil)
	if status != 200 {
		t.Fatal("metrics unavailable")
	}
	text := string(data)
	if !strings.Contains(text, `route="GET /api/v1/videos/{id}"`) || strings.Contains(text, id) || !strings.Contains(text, "peerscreen_db_max_connections 16") {
		t.Fatal("metrics expose identifiers or omit real request/pool observations")
	}
}
