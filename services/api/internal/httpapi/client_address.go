package httpapi

import (
	"net"
	"net/http"
	"net/netip"
)

// Trust only the configured gateway's direct TCP connection. The gateway
// overwrites this header; arbitrary forwarded headers never identify a user.
func (a *App) clientAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	remote, err := netip.ParseAddr(host)
	if err != nil {
		return "unknown"
	}
	remote = remote.Unmap()
	for _, prefix := range a.Config.TrustedProxies {
		if prefix.Contains(remote) {
			if client, err := netip.ParseAddr(r.Header.Get("X-PeerScreen-Client-IP")); err == nil {
				return client.Unmap().String()
			}
			break
		}
	}
	return remote.String()
}
