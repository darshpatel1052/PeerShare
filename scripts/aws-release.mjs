import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { awsEnvironment } from "./aws-environment.mjs";
import { localEnvironment } from "./local-environment.mjs";
import { gatewayConfig } from "./gateway-config.mjs";
import { restoreSnapshot } from "./restore-snapshot.mjs";

const run = promisify(execFile);
const config = await awsEnvironment();
const operation = process.argv[2] || "stage";
const sha =
  process.argv[3] || (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
assert.match(sha, /^[a-f0-9]{40}$/);
const directory = resolve(".local/aws/releases", sha);
await mkdir(directory, { recursive: true, mode: 0o700 });
const outputs = JSON.parse(
  (
    await run(
      resolve(".local/tools/terraform"),
      [
        "-chdir=deploy/terraform",
        "output",
        "-json",
        "-state=" + resolve(".local/aws/terraform/terraform.tfstate"),
      ],
      { env: config.env },
    )
  ).stdout,
);
const inputs = JSON.parse(
  await readFile(".local/aws/terraform/inputs.tfvars.json", "utf8"),
);
const buckets = outputs.private_buckets.value;
const repositories = outputs.image_repositories.value;
async function aws(args) {
  await run(config.cli, args, {
    env: config.env,
    timeout: 600000,
    maxBuffer: 8 * 1024 * 1024,
  });
}
async function privateFile(name, content) {
  await writeFile(join(directory, name), content, { mode: 0o600 });
  await chmod(join(directory, name), 0o600);
}
try {
  if (operation === "stage") {
    try {
      await readFile(join(directory, "stage.json"));
      console.log(
        "This release already has a verified private staging bundle.",
      );
      process.exit(0);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await run("git", [
      "archive",
      "--format=tar",
      "--output=" + join(directory, "source.tar"),
      sha,
    ]);
    await chmod(join(directory, "source.tar"), 0o600);
    const environment = await localEnvironment();
    const values = {
      GOOGLE_CLIENT_ID: environment.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: environment.GOOGLE_CLIENT_SECRET,
      PEERSCREEN_GATEWAY_ORIGIN: "https://" + inputs.app_domain,
      PEERSCREEN_GATEWAY_WS_ORIGIN: "wss://" + inputs.app_domain,
      AWS_REGION: inputs.region,
      S3_ORIGINALS_BUCKET: buckets.originals,
      S3_PROCESSED_BUCKET: buckets.processed,
      PEER_STUN_URLS: "stun:stun.cloudflare.com:3478",
    };
    for (const key of [
      "POSTGRES_PASSWORD",
      "CATALOG_DB_PASSWORD",
      "MEDIA_DB_PASSWORD",
      "REDIS_PASSWORD",
      "CATALOG_RPC_TOKEN",
      "WORKER_RPC_TOKEN",
    ])
      values[key] = randomBytes(32).toString("hex");
    // Retry incomplete staging without changing the database/RPC credentials.
    try {
      for (const line of (
        await readFile(join(directory, "runtime.env"), "utf8")
      )
        .trim()
        .split("\n")) {
        const split = line.indexOf("=");
        const key = line.slice(0, split);
        if (Object.hasOwn(values, key))
          values[key] = JSON.parse(line.slice(split + 1));
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    // Never source this file in a shell. Only Compose reads the dotenv syntax.
    if (Object.values(values).some((value) => /[\r\n\0]/.test(value)))
      throw new Error("Invalid multiline runtime value");
    await privateFile(
      "runtime.env",
      Object.entries(values)
        .map(([key, value]) => key + "=" + JSON.stringify(value))
        .join("\n") + "\n",
    );
    await privateFile(
      "release.env",
      `API_IMAGE=${repositories.api}:${sha}\nWEB_IMAGE=${repositories.web}:${sha}\n`,
    );
    await privateFile(
      "host.json",
      JSON.stringify(
        {
          region: inputs.region,
          origin: "origin-" + inputs.app_domain,
          domain: inputs.app_domain,
          roles: outputs.runtime_roles.value,
          repositories,
          buckets,
        },
        null,
        2,
      ) + "\n",
    );
    await privateFile(
      "envoy.json",
      JSON.stringify(
        gatewayConfig("https://" + inputs.app_domain, {
          originHost: "origin-" + inputs.app_domain,
          originSecret: inputs.origin_secret,
        }),
        null,
        2,
      ) + "\n",
    );
    const snapshot = (
      await readFile(".local/aws/backup-path.txt", "utf8")
    ).trim();
    const manifest = JSON.parse(
      await readFile(join(snapshot, "manifest.json"), "utf8"),
    );
    for (const name of ["database.dump", "media.tgz", "uploads.tgz"])
      assert.equal(
        createHash("sha256")
          .update(await readFile(join(snapshot, name)))
          .digest("hex"),
        manifest.archives[name].sha256,
      );
    await aws([
      "s3",
      "sync",
      join(snapshot, "uploads"),
      "s3://" + buckets.originals + "/",
      "--cache-control",
      "no-store",
      "--only-show-errors",
    ]);
    await aws([
      "s3",
      "sync",
      join(snapshot, "media"),
      "s3://" + buckets.processed + "/",
      "--exclude",
      "*",
      "--include",
      "videos/*",
      "--include",
      "images/*",
      "--cache-control",
      "no-store",
      "--only-show-errors",
    ]);
    const verify = join(directory, "verify");
    for (const [name, bucket] of [
      ["uploads", buckets.originals],
      ["media", buckets.processed],
    ]) {
      await aws([
        "s3",
        "sync",
        "s3://" + bucket + "/",
        join(verify, name),
        "--only-show-errors",
      ]);
      for (const [key, hash] of Object.entries(manifest.fingerprints[name])) {
        if (
          name === "media" &&
          !key.startsWith("videos/") &&
          !key.startsWith("images/")
        )
          continue;
        assert.equal(
          createHash("sha256")
            .update(await readFile(join(verify, name, key)))
            .digest("hex"),
          hash,
        );
      }
    }
    await rm(verify, { recursive: true });
    const backupPrefix =
      "snapshots/" + manifest.checkedAt.replaceAll(":", "-") + "/";
    for (const name of [
      "database.dump",
      "media.tgz",
      "uploads.tgz",
      "manifest.json",
    ]) {
      await aws([
        "s3",
        "cp",
        join(snapshot, name),
        "s3://" + buckets.backups + "/" + backupPrefix + name,
        "--only-show-errors",
      ]);
      if (name !== "manifest.json")
        await privateFile(name, await readFile(join(snapshot, name)));
    }
    await privateFile(
      "stage.json",
      JSON.stringify(
        {
          sha,
          stagedAt: new Date().toISOString(),
          migratedFileHashesMatched: true,
          snapshotUploaded: true,
          googleConfigured: Boolean(
            values.GOOGLE_CLIENT_ID && values.GOOGLE_CLIENT_SECRET,
          ),
          backupPrefix,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "Staged the exact source release, private runtime settings and verified snapshot. AWS media download hashes match; private backup archives uploaded.",
    );
  } else if (operation === "verify-backup") {
    const stage = JSON.parse(
      await readFile(join(directory, "stage.json"), "utf8"),
    );
    const target = join(directory, "aws-backup-restore");
    await mkdir(target, { recursive: true, mode: 0o700 });
    for (const name of [
      "database.dump",
      "media.tgz",
      "uploads.tgz",
      "manifest.json",
    ]) {
      await aws([
        "s3",
        "cp",
        "s3://" + buckets.backups + "/" + stage.backupPrefix + name,
        join(target, name),
        "--only-show-errors",
      ]);
      await chmod(join(target, name), 0o600);
    }
    const evidence = {
      ...(await restoreSnapshot(target)),
      scope:
        "Actual private AWS snapshot download; isolated networkless PostgreSQL restore and archive extraction",
      awsSnapshotRestore: true,
    };
    await privateFile(
      "aws-backup-restore.json",
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(JSON.stringify(evidence));
  } else if (operation === "prepare-host") {
    const ip = outputs.public_ip?.value;
    assert.match(ip || "", /^\d{1,3}(\.\d{1,3}){3}$/);
    await readFile(join(directory, "stage.json"));
    const options = [
      "-i",
      resolve(".local/aws/ssh/id_ed25519"),
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "UserKnownHostsFile=" + resolve(".local/aws/ssh/known_hosts"),
      "-o",
      "ConnectTimeout=10",
      "-o",
      "BatchMode=yes",
    ];
    const target = "ubuntu@" + ip;
    await run(
      "ssh",
      [...options, target, "mkdir -p -m 700 /home/ubuntu/peerscreen-bundle"],
      { timeout: 30000 },
    );
    const script = `#!/bin/bash
set -euo pipefail
cloud-init status --wait
cd /home/ubuntu/peerscreen-bundle
mkdir -p /srv/peerscreen/releases/${sha} /srv/peerscreen/gateway /srv/peerscreen/tls
tar -xf source.tar -C /srv/peerscreen/releases/${sha}
if [ ! -L /srv/peerscreen/current ]; then ln -s /srv/peerscreen/releases/${sha} /srv/peerscreen/current; fi
install -m 600 runtime.env /srv/peerscreen/runtime.env
install -m 600 host.json /srv/peerscreen/host.json
install -m 600 release.env /srv/peerscreen/release.env
install -o 10001 -g 10001 -m 600 envoy.json /srv/peerscreen/gateway/envoy.json
bash /srv/peerscreen/current/deploy/host/install.sh
cd /srv/peerscreen/releases/${sha}
registry=$(python3 -c 'import json; print(json.load(open("/srv/peerscreen/host.json"))["repositories"]["api"].split("/")[0])')
aws ecr get-login-password --region ${inputs.region} | docker login --username AWS --password-stdin "$registry"
compose=(docker compose -p peerscreen --env-file /srv/peerscreen/runtime.env --env-file /srv/peerscreen/release.env -f deploy/compose/local.yml -f deploy/compose/gateway.yml -f deploy/compose/production.yml --profile app)
"\${compose[@]}" pull api web
if [ ! -f /srv/peerscreen/data-restored ]; then
  "\${compose[@]}" up -d --no-build --wait --wait-timeout 120 postgres
  "\${compose[@]}" exec -T postgres pg_restore -U peerscreen_admin -d peerscreen --clean --if-exists --exit-on-error < /home/ubuntu/peerscreen-bundle/database.dump
  "\${compose[@]}" run --rm --no-deps storage-init
  for name in media uploads; do
    if [ "$name" = media ]; then volume=peerscreen_media-data; else volume=peerscreen_upload-data; fi
    docker run --rm --user 0:0 --entrypoint tar -v "$volume:/data" -v /home/ubuntu/peerscreen-bundle:/backup:ro ${repositories.api}:${sha} -C /data -xzf "/backup/$name.tgz"
  done
  touch /srv/peerscreen/data-restored
fi
systemctl is-active peerscreen-roles.timer
systemctl list-timers peerscreen-demo-stop.timer --no-pager
echo 'Host roles, images and restored data prepared; origin certificate and application rollout remain.'
`;
    await privateFile("prepare-host.sh", script);
    const names = [
      "source.tar",
      "runtime.env",
      "release.env",
      "host.json",
      "envoy.json",
      "database.dump",
      "media.tgz",
      "uploads.tgz",
      "prepare-host.sh",
    ];
    await run(
      "scp",
      [
        ...options,
        ...names.map((name) => join(directory, name)),
        target + ":/home/ubuntu/peerscreen-bundle/",
      ],
      { timeout: 600000, maxBuffer: 1024 * 1024 },
    );
    const result = await run(
      "ssh",
      [
        ...options,
        target,
        "sudo bash /home/ubuntu/peerscreen-bundle/prepare-host.sh",
      ],
      { timeout: 1200000, maxBuffer: 16 * 1024 * 1024 },
    );
    await privateFile("host-preparation.log", result.stdout + result.stderr);
    console.log(
      "Host data restored, scoped role refresh timer running and immutable images pulled. Origin certificate/application startup still pending.",
    );
  } else throw new Error("Use stage, verify-backup or prepare-host");
} catch (error) {
  await privateFile("last-error.txt", String(error.stderr || error.message));
  console.error("Release staging failed. Inspect its private diagnostic file.");
  process.exitCode = 1;
}
