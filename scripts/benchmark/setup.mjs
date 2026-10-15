import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import {
  hostCommand,
  sql,
  execute,
  sshOptions,
  hostTarget,
  privateError,
} from "./host.mjs";
import { gatewayConfig } from "../gateway-config.mjs";
const sha = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(sha || ""))
  throw Error("Use a full published source SHA");
const root = resolve(".local/benchmark");
await mkdir(root, { recursive: true, mode: 0o700 });
const id = (kind, i) => {
  const s = createHash("md5").update(`benchmark:${kind}:${i}`).digest("hex");
  return (
    s.slice(0, 8) +
    "-" +
    s.slice(8, 12) +
    "-" +
    s.slice(12, 16) +
    "-" +
    s.slice(16, 20) +
    "-" +
    s.slice(20)
  );
};
try {
  let password;
  try {
    password = (await readFile(join(root, "db-password"), "utf8")).trim();
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    password = randomBytes(32).toString("hex");
    await writeFile(join(root, "db-password"), password, { mode: 0o600 });
  }
  const state = JSON.parse(
    await readFile(".local/aws/terraform/terraform.tfstate", "utf8"),
  ).outputs;
  const image = state.image_repositories.value.api + ":" + sha;
  const config = gatewayConfig("https://peerscreen.darshpatel.dev:38443");
  config.static_resources.clusters = config.static_resources.clusters.filter(
    (c) => c.name === "catalogue",
  );
  config.static_resources.clusters[0].load_assignment.endpoints[0].lb_endpoints[0].endpoint.address.socket_address.address =
    "bench-api";
  const routeConfig =
    config.static_resources.listeners[0].filter_chains[0].filters[0]
      .typed_config.route_config;
  routeConfig.virtual_hosts[0].routes =
    routeConfig.virtual_hosts[0].routes.filter(
      (r) => r.route?.cluster !== "tracker" && r.route?.cluster !== "web",
    );
  routeConfig.virtual_hosts[0].routes.push({
    match: { prefix: "/" },
    direct_response: { status: 404 },
  });
  await writeFile(
    join(root, "envoy.json"),
    JSON.stringify(config, null, 2) + "\n",
    { mode: 0o600 },
  );
  await writeFile(join(root, "release.env"), "API_IMAGE=" + image + "\n", {
    mode: 0o600,
  });
  if (!/^[a-f0-9]{64}$/.test(password))
    throw Error("Invalid private database password");
  await sql(
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='peerscreen_benchmark') THEN CREATE ROLE peerscreen_benchmark LOGIN PASSWORD '${password}' CONNECTION LIMIT 48; END IF; END $$;`,
  );
  const owner = (
    await sql(
      "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='peerscreen_benchmark';",
    )
  ).trim();
  if (!owner)
    await sql(
      "CREATE DATABASE peerscreen_benchmark OWNER peerscreen_benchmark;",
    );
  else if (owner !== "peerscreen_benchmark")
    throw Error("Existing benchmark database has an unexpected owner");
  await sql(
    `CREATE SCHEMA IF NOT EXISTS catalog AUTHORIZATION peerscreen_benchmark;`,
    { database: "peerscreen_benchmark" },
  );
  const target = await hostTarget();
  await hostCommand("mkdir -p -m 700 /home/ubuntu/peerscreen-benchmark\n");
  await execute("scp", [
    ...sshOptions,
    "deploy/benchmark/compose.yml",
    join(root, "envoy.json"),
    join(root, "release.env"),
    target + ":/home/ubuntu/peerscreen-benchmark/",
  ]);
  const encodedPassword = Buffer.from(password).toString("base64");
  await hostCommand(
    `sudo mkdir -p /srv/peerscreen/benchmark
sudo chmod 700 /srv/peerscreen/benchmark
sudo install -m 600 /home/ubuntu/peerscreen-benchmark/compose.yml /srv/peerscreen/benchmark/compose.yml
sudo install -m 600 /home/ubuntu/peerscreen-benchmark/release.env /srv/peerscreen/benchmark/release.env
sudo install -o 10001 -g 10001 -m 600 /home/ubuntu/peerscreen-benchmark/envoy.json /srv/peerscreen/benchmark/envoy.json
sudo python3 - <<'PY'
import json,base64
from pathlib import Path
values={}
for line in Path('/srv/peerscreen/runtime.env').read_text().splitlines():
 key,raw=line.split('=',1);values[key]=json.loads(raw)
password=base64.b64decode('${encodedPassword}').decode()
env={'DATABASE_URL':'postgres://peerscreen_benchmark:'+password+'@postgres:5432/peerscreen_benchmark?sslmode=disable','REDIS_URL':'redis://:'+values['REDIS_PASSWORD']+'@redis:6379/2','ANALYTICS_REDIS_URL':'redis://:'+values['REDIS_PASSWORD']+'@redis-cache:6379/2','APP_ENV':'production','APP_ORIGIN':'https://peerscreen.darshpatel.dev:38443','MEDIA_BASE_URL':'https://peerscreen.darshpatel.dev:38443/media/','TRACKER_URL':'wss://peerscreen.darshpatel.dev:38443/tracker','READ_ONLY_MODE':'true','REGISTRATION_ENABLED':'false','UPLOADS_ENABLED':'false','PEER_STUN_URLS':'off','API_LISTEN_ADDR':'0.0.0.0:8080','UPLOAD_DIR':'/tmp/benchmark-uploads','MEDIA_DIR':'/tmp/benchmark-media','API_REPLICA_DIAGNOSTICS':'true','RATE_PREFIX':'peerscreen:benchmark:auth','AUTH_LIMIT_PER_MINUTE':'120'}
path=Path('/srv/peerscreen/benchmark/api.env');path.write_text(chr(10).join(k+'='+v for k,v in env.items())+chr(10));path.chmod(0o600)
PY
sudo sh -c 'aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin ${image.split("/")[0]}' >/dev/null
sudo docker compose -p peerscreen-benchmark --env-file /srv/peerscreen/benchmark/release.env -f /srv/peerscreen/benchmark/compose.yml pull bench-api
sudo docker compose -p peerscreen-benchmark --env-file /srv/peerscreen/benchmark/release.env -f /srv/peerscreen/benchmark/compose.yml run --rm --no-deps bench-api migrate
`,
    { timeout: 360000 },
  );
  const counts = await sql(
    await readFile("deploy/benchmark/seed.sql", "utf8"),
    { database: "peerscreen_benchmark" },
  );
  let members;
  try {
    members = JSON.parse(await readFile(join(root, "users.json"), "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    members = Array.from({ length: 256 }, (_, i) => {
      const n = i + 1;
      return {
        userID: id("user", n),
        channelID: id("channel", n),
        playlistID: id("playlist", n),
        token: randomBytes(32).toString("base64url"),
      };
    });
    await writeFile(join(root, "users.json"), JSON.stringify(members), {
      mode: 0o600,
    });
  }
  const sessionData = Buffer.from(
    JSON.stringify(
      members.map((m) => ({
        id: m.userID,
        hash: createHash("sha256").update(m.token).digest("hex"),
      })),
    ),
  ).toString("base64");
  await sql(
    `INSERT INTO catalog.sessions(token_hash,user_id,expires_at) SELECT decode(hash,'hex'),id,now()+interval '24 hours' FROM jsonb_to_recordset(convert_from(decode('${sessionData}','base64'),'UTF8')::jsonb) AS x(id uuid,hash text) ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at,revoked_at=NULL;`,
    { database: "peerscreen_benchmark" },
  );
  await hostCommand(
    "sudo docker compose -p peerscreen-benchmark --env-file /srv/peerscreen/benchmark/release.env -f /srv/peerscreen/benchmark/compose.yml up -d --wait --wait-timeout 120\n",
    { timeout: 180000 },
  );
  const result = {
    checkedAt: new Date().toISOString(),
    release: sha,
    scope:
      "Private read-only catalogue benchmark on the existing AWS host; synthetic metadata only",
    counts: JSON.parse(counts.trim().split("\n").at(-1)),
    apiReplicas: 2,
    sourceSQLSHA256: createHash("sha256")
      .update(await readFile("deploy/benchmark/seed.sql"))
      .digest("hex"),
    backgroundWorkers: false,
    kafkaConsumers: false,
    liveMediaAccess: false,
    separateDatabase: true,
    separateRedisIndex: true,
  };
  await writeFile(
    join(root, "dataset.json"),
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
} catch (e) {
  await privateError("setup-error.txt", e);
}
