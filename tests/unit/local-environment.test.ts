import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const moduleURL = new URL(
  "../../scripts/local-environment.mjs",
  import.meta.url,
).href;

for (const scenario of [
  {
    name: "Google credentials in local.env are loaded",
    dedicated: false,
    process: false,
    expected: "local",
  },
  {
    name: "process Google credentials override local.env",
    dedicated: false,
    process: true,
    expected: "process",
  },
  {
    name: "dedicated Google file retains its override",
    dedicated: true,
    process: true,
    expected: "dedicated",
  },
]) {
  test(
    scenario.name + "; isolated runtime excludes all provider credentials",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "peerscreen-config-"));
      try {
        await mkdir(join(directory, ".local"));
        const database = [
          "POSTGRES_PASSWORD",
          "CATALOG_DB_PASSWORD",
          "REDIS_PASSWORD",
        ]
          .map((key) => `${key}=${"a".repeat(64)}`)
          .join("\n");
        await writeFile(
          join(directory, ".local/local.env"),
          database +
            "\nGOOGLE_CLIENT_ID=local-id\nGOOGLE_CLIENT_SECRET=local-secret\n",
          { mode: 0o600 },
        );
        if (scenario.dedicated)
          await writeFile(
            join(directory, ".local/google.env"),
            "GOOGLE_CLIENT_ID=dedicated-id\nGOOGLE_CLIENT_SECRET=dedicated-secret\n",
            { mode: 0o600 },
          );
        // A separate process/cwd avoids touching the real creator's ignored credentials or global test state.
        // Print booleans only, even if the loader regresses: secret values never appear in assertions.
        const environment = {
          ...process.env,
          GOOGLE_CLIENT_ID: scenario.process ? "process-id" : "",
          GOOGLE_CLIENT_SECRET: scenario.process ? "process-secret" : "",
          PEER_STUN_URLS: "stun:stun.cloudflare.com:3478",
        };
        delete environment.NODE_TEST_CONTEXT;
        const result = await run(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `
        import {localEnvironment} from ${JSON.stringify(moduleURL)};
        const normal=await localEnvironment();
        const isolated=await localEnvironment({test:true});
        console.log(JSON.stringify({
          idMatches:normal.GOOGLE_CLIENT_ID===${JSON.stringify(scenario.expected + "-id")},
          secretMatches:normal.GOOGLE_CLIENT_SECRET===${JSON.stringify(scenario.expected + "-secret")},
          isolatedIdEmpty:isolated.GOOGLE_CLIENT_ID==="",
          isolatedSecretEmpty:isolated.GOOGLE_CLIENT_SECRET===""
						,isolatedSTUNEmpty:isolated.PEER_STUN_URLS===""
        }));
      `,
          ],
          {
            cwd: directory,
            env: environment,
          },
        );
        assert.deepEqual(JSON.parse(result.stdout), {
          idMatches: true,
          secretMatches: true,
          isolatedIdEmpty: true,
          isolatedSecretEmpty: true,
          isolatedSTUNEmpty: true,
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
