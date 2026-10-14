import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

// Relay the WebTorrent WebSocket announce protocol, without its UDP/HTTP IP
// parser or remote URL fetching. Protocol: webtorrent/bittorrent-tracker/server.js.
export function createTracker({
  allowedOrigins = [process.env.APP_ORIGIN || "http://localhost:3000"],
  path = "/",
} = {}) {
  const swarms = new Map(),
    pending = new Map();
  const counters = { announcements: 0, offers: 0, answers: 0, rejected: 0 };
  const http = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health/live") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"status":"ok"}');
    } else if (request.method === "GET" && request.url === "/metrics") {
      response.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
      response.end(
        `peerscreen_tracker_connections ${ws.clients.size}\npeerscreen_tracker_swarms ${swarms.size}\n${Object.entries(
          counters,
        )
          .map(([name, count]) => `peerscreen_tracker_${name}_total ${count}\n`)
          .join("")}`,
      );
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  const ws = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  http.ws = ws;
  http.http = http;
  http.on("error", () => console.error("tracker_listener_failed"));
  http.on("upgrade", (request, socket, head) => {
    if (
      request.url !== path ||
      !allowedOrigins.includes(request.headers.origin) ||
      ws.clients.size >= 256
    ) {
      counters.rejected++;
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    ws.handleUpgrade(request, socket, head, (client) =>
      ws.emit("connection", client),
    );
  });
  const binaryID = (value) =>
    typeof value === "string" &&
    value.length === 20 &&
    [...value].every((char) => char.charCodeAt(0) <= 255);
  const description = (value, type) =>
    value?.type === type &&
    typeof value.sdp === "string" &&
    value.sdp.length > 0 &&
    value.sdp.length <= 16384;
  const send = (socket, value) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 128 * 1024) {
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(value), (error) => {
      if (error) socket.terminate();
    });
  };
  function leave(socket, hash) {
    const swarm = swarms.get(hash);
    if (swarm?.get(socket.peerID)?.socket === socket)
      swarm.delete(socket.peerID);
    if (swarm?.size === 0) swarms.delete(hash);
    socket.memberships.delete(hash);
  }
  ws.on("connection", (socket) => {
    socket.memberships = new Set();
    socket.peerID = null;
    socket.lastSeen = Date.now();
    socket.windowStart = Date.now();
    socket.messages = 0;
    socket.on("error", () => {});
    socket.on("close", () => {
      for (const hash of [...socket.memberships]) leave(socket, hash);
      for (const [key, value] of pending)
        if (value.from === socket || value.to === socket) pending.delete(key);
    });
    socket.on("message", (bytes, isBinary) => {
      const now = Date.now();
      if (now - socket.windowStart >= 10000) {
        socket.windowStart = now;
        socket.messages = 0;
      }
      if (isBinary || ++socket.messages > 80) {
        counters.rejected++;
        socket.close(1008, "Invalid signalling request");
        return;
      }
      let message;
      try {
        message = JSON.parse(bytes.toString());
      } catch {
        socket.close(1008, "Invalid signalling request");
        return;
      }
      const hash = message?.info_hash;
      if (
        message?.action !== "announce" ||
        !binaryID(hash) ||
        !binaryID(message.peer_id) ||
        (socket.peerID && socket.peerID !== message.peer_id) ||
        ![undefined, "started", "stopped", "completed", "update"].includes(
          message.event,
        )
      ) {
        counters.rejected++;
        socket.close(1008, "Invalid signalling request");
        return;
      }
      socket.peerID = message.peer_id;
      socket.lastSeen = now;
      if (message.event === "stopped") {
        leave(socket, hash);
        send(socket, {
          action: "announce",
          info_hash: hash,
          interval: 10,
          complete: 0,
          incomplete: 0,
        });
        return;
      }
      const offers = message.offers ?? [];
      if (
        !Array.isArray(offers) ||
        offers.length > 8 ||
        offers.some(
          (item) =>
            !binaryID(item?.offer_id) || !description(item.offer, "offer"),
        ) ||
        (message.answer &&
          (!binaryID(message.offer_id) ||
            !binaryID(message.to_peer_id) ||
            !description(message.answer, "answer")))
      ) {
        counters.rejected++;
        socket.close(1008, "Invalid connection description");
        return;
      }
      let swarm = swarms.get(hash);
      if (
        (!swarm && swarms.size >= 128) ||
        (!socket.memberships.has(hash) && socket.memberships.size >= 8) ||
        (swarm && !swarm.has(socket.peerID) && swarm.size >= 64)
      ) {
        counters.rejected++;
        send(socket, {
          action: "announce",
          info_hash: hash,
          "failure reason": "Discovery capacity is full",
        });
        return;
      }
      if (!swarm) {
        swarm = new Map();
        swarms.set(hash, swarm);
      }
      const existing = swarm.get(socket.peerID);
      if (existing && existing.socket !== socket) {
        socket.close(1008, "Peer identity is in use");
        return;
      }
      swarm.set(socket.peerID, { socket, complete: message.left === 0 });
      socket.memberships.add(hash);
      counters.announcements++;
      if (message.answer) {
        const key = JSON.stringify([
          hash,
          message.to_peer_id,
          message.offer_id,
        ]);
        const offer = pending.get(key);
        if (
          offer?.to === socket &&
          offer.expires > now &&
          swarm.get(message.to_peer_id)?.socket === offer.from
        ) {
          send(offer.from, {
            action: "announce",
            info_hash: hash,
            peer_id: socket.peerID,
            offer_id: message.offer_id,
            answer: message.answer,
          });
          pending.delete(key);
          counters.answers++;
        }
        return;
      }
      const complete = [...swarm.values()].filter(
        (peer) => peer.complete,
      ).length;
      send(socket, {
        action: "announce",
        info_hash: hash,
        interval: 10,
        complete,
        incomplete: swarm.size - complete,
      });
      const peers = [...swarm.values()].filter(
        (peer) =>
          peer.socket !== socket && peer.socket.readyState === WebSocket.OPEN,
      );
      for (let index = peers.length - 1; index > 0; index--) {
        const other = randomInt(index + 1);
        [peers[index], peers[other]] = [peers[other], peers[index]];
      }
      let fromCount = [...pending.values()].filter(
        (value) => value.from === socket,
      ).length;
      for (
        let index = 0;
        index < Math.min(peers.length, offers.length);
        index++
      ) {
        if (pending.size >= 4096 || fromCount >= 32) break;
        const item = offers[index],
          target = peers[index].socket;
        pending.set(JSON.stringify([hash, socket.peerID, item.offer_id]), {
          from: socket,
          to: target,
          expires: now + 60000,
        });
        send(target, {
          action: "announce",
          info_hash: hash,
          peer_id: socket.peerID,
          offer_id: item.offer_id,
          offer: item.offer,
        });
        counters.offers++;
        fromCount++;
      }
    });
  });
  const timer = setInterval(() => {
    const now = Date.now();
    for (const socket of ws.clients)
      if (now - socket.lastSeen > 45000) socket.terminate();
    for (const [key, value] of pending)
      if (value.expires <= now) pending.delete(key);
  }, 5000);
  timer.unref();
  const close = http.close.bind(http);
  http.close = (callback) => {
    clearInterval(timer);
    for (const socket of ws.clients) socket.terminate();
    ws.close();
    return close(callback);
  };
  return http;
}
