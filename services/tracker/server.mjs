import { Server } from "bittorrent-tracker";

// A real WebTorrent-compatible tracker, restricted to the loopback demo.
export function createTracker() {
  const server = new Server({
    http: false,
    udp: false,
    ws: true,
    stats: false,
    interval: 10_000,
  });
  server.on("error", (error) => console.error("Tracker error:", error.message));
  // Do not log peer addresses, tracker parameters, or signalling payloads.
  server.on("warning", () => {});
  server.http.prependListener("request", (request, response) => {
    if (request.url === "/health/live") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"status":"ok"}');
    }
  });
  return server;
}
