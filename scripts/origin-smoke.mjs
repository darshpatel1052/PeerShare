import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import https from "node:https";
import WebSocket from "ws";
import { gatewayConfig } from "./gateway-config.mjs";

const run = promisify(execFile);
const network = "peerscreen-origin-check";
const upstream = "peerscreen-origin-upstream";
const gateway = "peerscreen-origin-gateway";
const directory = resolve(".local/origin-check");
const secret = randomBytes(32).toString("hex");
const host = "origin-peerscreen.example.test";
const image =
  "envoyproxy/envoy:v1.39.4@sha256:74bd4eb5629708d3fadca1a5e6b85d208f338d7bb54e06b69565905c5294cc01";
async function docker(args) {
  return run("docker", args, { timeout: 60000 });
}
function request(path, headers = {}) {
  return new Promise((accept, reject) => {
    const req = https.get(
      "https://localhost:3444" + path,
      { rejectUnauthorized: false, headers: { Host: host, ...headers } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          accept({ status: res.statusCode, body, headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
  });
}
try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(directory, "envoy.json"),
    JSON.stringify(
      gatewayConfig("https://peershare.example.test", {
        legacyRedirectHost: "peerscreen.example.test",
        originHost: host,
        originSecret: secret,
      }),
    ),
    { mode: 0o600 },
  );
  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    resolve(directory, "key.pem"),
    "-out",
    resolve(directory, "cert.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=" + host,
  ]);
  await docker(["network", "create", network]);
  const stub = `const http=require('node:http');const {WebSocketServer}=require('ws');
    for(const port of [8080,3000,8000]) { const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:req.url,client:req.headers['x-peerscreen-client-ip']}));});
    if(port===8000){const ws=new WebSocketServer({server});ws.on('connection',socket=>socket.send('tracker-connected'));}server.listen(port,'0.0.0.0');}`;
  await docker([
    "run",
    "-d",
    "--name",
    upstream,
    "--network",
    network,
    "--network-alias",
    "api",
    "--network-alias",
    "web",
    "peerscreen-web:local",
    "node",
    "-e",
    stub,
  ]);
  const mount = ["-v", directory + ":/config:ro", "-v", directory + ":/tls:ro"];
  await docker([
    "run",
    "--rm",
    "--user",
    `${process.getuid()}:${process.getgid()}`,
    ...mount,
    image,
    "envoy",
    "--mode",
    "validate",
    "-c",
    "/config/envoy.json",
  ]);
  await docker([
    "run",
    "-d",
    "--name",
    gateway,
    "--network",
    network,
    "--user",
    `${process.getuid()}:${process.getgid()}`,
    ...mount,
    "-p",
    "127.0.0.1:3444:8443",
    image,
    "envoy",
    "-c",
    "/config/envoy.json",
    "--concurrency",
    "1",
    "--log-level",
    "error",
  ]);
  const headers = {
    "X-PeerScreen-Origin": secret,
    "CloudFront-Viewer-Address": "198.51.100.7:43210",
    "X-PeerScreen-Client-IP": "192.0.2.8",
  };
  const end = Date.now() + 15000;
  let response;
  while (Date.now() < end) {
    try {
      response = await request("/api/v1/me", headers);
      if (response.status === 200) break;
    } catch {}
    await new Promise((accept) => setTimeout(accept, 200));
  }
  assert.equal(response?.status, 200);
  assert.equal(
    JSON.parse(response.body).client,
    headers["CloudFront-Viewer-Address"],
  );
  const secondViewer = await request("/api/v1/me", {
    ...headers,
    "CloudFront-Viewer-Address": "198.51.100.8:43211",
  });
  assert.equal(JSON.parse(secondViewer.body).client, "198.51.100.8:43211");
  assert.notEqual(
    JSON.parse(secondViewer.body).client,
    JSON.parse(response.body).client,
  );
  const legacy = await request("/watch/?v=example", {
    Host: "peerscreen.example.test",
  });
  assert.equal(legacy.status, 308);
  assert.equal(
    legacy.headers.location,
    "https://peershare.example.test/watch/?v=example",
  );
  assert.equal((await request("/api/v1/me")).status, 403);
  assert.equal(
    (await request("/api/v1/me", { "X-PeerScreen-Origin": "wrong" })).status,
    403,
  );
  assert.equal((await request("/metrics", headers)).status, 404);
  assert.equal(
    JSON.parse(
      (await request("/media/videos/example/master.m3u8", headers)).body,
    ).path,
    "/api/v1/media/videos/example/master.m3u8",
  );
  await new Promise((accept, reject) => {
    const ws = new WebSocket("wss://localhost:3444/tracker", {
      rejectUnauthorized: false,
      headers: { Host: host, ...headers },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("Origin WebSocket did not connect"));
    }, 10000);
    ws.once("error", reject);
    ws.once("message", (data) => {
      clearTimeout(timer);
      assert.equal(data.toString(), "tracker-connected");
      ws.close();
      accept();
    });
  });
  const evidence = {
    checkedAt: new Date().toISOString(),
    scope:
      "Real pinned Envoy container; simulated CloudFront request headers, local TLS and stub upstreams",
    configValid: true,
    missingSecret403: true,
    wrongSecret403: true,
    acceptedSecret200: true,
    trustedViewerAddressOverwritesSpoof: true,
    distinctViewerAddressesPreserved: true,
    distinctLegacyHostnameRedirect308: true,
    mediaPathRewrite: true,
    privateMetrics404: true,
    websocketUpgrade: true,
    actualCloudFront: false,
  };
  await mkdir(".local/evidence", { recursive: true });
  await writeFile(
    ".local/evidence/phase-5-origin.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence));
} finally {
  await docker(["rm", "-f", gateway, upstream]).catch(() => {});
  await docker(["network", "rm", network]).catch(() => {});
}
