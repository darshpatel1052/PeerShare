import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export function gatewayConfig(origin) {
  const parsed = new URL(origin);
  if (
    parsed.protocol !== "https:" ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  )
    throw new Error("Gateway origin must be an HTTPS authority");
  const address = (host, port) => ({
    socket_address: { address: host, port_value: port },
  });
  const router = {
    name: "envoy.filters.http.router",
    typed_config: {
      "@type":
        "type.googleapis.com/envoy.extensions.filters.http.router.v3.Router",
    },
  };
  const route = (match, cluster, extra = {}) => ({
    match,
    route: { cluster, timeout: "120s", ...extra },
  });
  const routes = [
    { match: { path: "/metrics" }, direct_response: { status: 404 } },
    { match: { prefix: "/media/fixture/" }, direct_response: { status: 404 } },
    route({ path: "/tracker" }, "tracker", {
      prefix_rewrite: "/",
      timeout: "0s",
      idle_timeout: "60s",
      upgrade_configs: [{ upgrade_type: "websocket", enabled: true }],
    }),
    route({ prefix: "/media/videos/" }, "catalogue", {
      prefix_rewrite: "/api/v1/media/videos/",
    }),
    route({ prefix: "/api/v1/" }, "catalogue"),
    route({ prefix: "/health/" }, "catalogue"),
    route({ prefix: "/" }, "web"),
  ];
  const hcm = {
    "@type":
      "type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager",
    stat_prefix: "peerscreen",
    codec_type: "AUTO",
    use_remote_address: true,
    normalize_path: true,
    merge_slashes: true,
    path_with_escaped_slashes_action: "REJECT_REQUEST",
    request_headers_timeout: "5s",
    stream_idle_timeout: "120s",
    max_request_headers_kb: 16,
    upgrade_configs: [{ upgrade_type: "websocket", enabled: false }],
    route_config: {
      name: "application",
      request_headers_to_remove: [
        "forwarded",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-proto",
        "x-user-id",
      ],
      request_headers_to_add: [
        {
          header: {
            key: "x-peerscreen-client-ip",
            value: "%DOWNSTREAM_REMOTE_ADDRESS_WITHOUT_PORT%",
          },
          append_action: "OVERWRITE_IF_EXISTS_OR_ADD",
        },
      ],
      response_headers_to_add: [
        {
          header: { key: "x-content-type-options", value: "nosniff" },
          append_action: "OVERWRITE_IF_EXISTS_OR_ADD",
        },
        {
          header: {
            key: "referrer-policy",
            value: "strict-origin-when-cross-origin",
          },
          append_action: "OVERWRITE_IF_EXISTS_OR_ADD",
        },
        {
          header: { key: "x-frame-options", value: "DENY" },
          append_action: "OVERWRITE_IF_EXISTS_OR_ADD",
        },
      ],
      virtual_hosts: [{ name: "peerscreen", domains: [parsed.host], routes }],
    },
    http_filters: [router],
  };
  const cluster = (name, host, port, ready) => ({
    name,
    cluster_type: {
      name: "envoy.clusters.dns",
      typed_config: {
        "@type":
          "type.googleapis.com/envoy.extensions.clusters.dns.v3.DnsCluster",
        dns_refresh_rate: "2s",
        dns_lookup_family: "V4_ONLY",
        all_addresses_in_single_endpoint: false,
      },
    },
    connect_timeout: "2s",
    lb_policy: "ROUND_ROBIN",
    load_assignment: {
      cluster_name: name,
      endpoints: [
        { lb_endpoints: [{ endpoint: { address: address(host, port) } }] },
      ],
    },
    circuit_breakers: {
      thresholds: [
        {
          priority: "DEFAULT",
          max_connections: 64,
          max_pending_requests: 64,
          max_requests: 128,
          max_retries: 0,
        },
      ],
    },
    ...(ready
      ? {
          health_checks: [
            {
              timeout: "1s",
              interval: "2s",
              no_traffic_interval: "2s",
              no_traffic_healthy_interval: "2s",
              unhealthy_threshold: 2,
              healthy_threshold: 1,
              http_health_check: { path: ready },
            },
          ],
        }
      : {}),
  });
  return {
    admin: { address: address("0.0.0.0", 9901), access_log: [] },
    static_resources: {
      listeners: [
        {
          name: "https",
          address: address("0.0.0.0", 8443),
          per_connection_buffer_limit_bytes: 32768,
          filter_chains: [
            {
              filters: [
                {
                  name: "envoy.filters.network.http_connection_manager",
                  typed_config: hcm,
                },
              ],
              transport_socket: {
                name: "envoy.transport_sockets.tls",
                typed_config: {
                  "@type":
                    "type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext",
                  common_tls_context: {
                    tls_params: { tls_minimum_protocol_version: "TLSv1_2" },
                    tls_certificates: [
                      {
                        certificate_chain: { filename: "/tls/cert.pem" },
                        private_key: { filename: "/tls/key.pem" },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      ],
      clusters: [
        cluster("catalogue", "api", 8080, "/health/ready"),
        cluster("web", "web", 3000, "/health/live"),
        cluster("tracker", "web", 8000, "/health/live"),
      ],
    },
  };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const directory = resolve(".local/gateway");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(directory, "envoy.json"),
    JSON.stringify(
      gatewayConfig(
        process.env.PEERSCREEN_GATEWAY_ORIGIN || "https://localhost:3443",
      ),
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
}
