import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mediaEnvironment } from "./media-environment.mjs";

export async function localEnvironment({ test = false } = {}) {
  const path = resolve(".local/local.env");
  try {
    await access(path);
  } catch {
    await mkdir(resolve(".local"), { recursive: true });
    const admin = randomBytes(32).toString("hex");
    const catalog = randomBytes(32).toString("hex");
    const redis = randomBytes(32).toString("hex");
    await writeFile(
      path,
      `POSTGRES_PASSWORD=${admin}\nCATALOG_DB_PASSWORD=${catalog}\nREDIS_PASSWORD=${redis}\n`,
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      "Created private local development credentials in .local/local.env.",
    );
  }
  const values = Object.fromEntries(
    (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
  for (const name of [
    "POSTGRES_PASSWORD",
    "CATALOG_DB_PASSWORD",
    "REDIS_PASSWORD",
  ])
    if (!/^[a-f0-9]{64}$/.test(values[name]))
      throw new Error(`Invalid ${name} in the local configuration`);
  // Optional Google credentials are server-only, ignored by Git, and never loaded into test runtimes.
  const google = { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" };
  if (!test) {
    google.GOOGLE_CLIENT_ID =
      process.env.GOOGLE_CLIENT_ID || values.GOOGLE_CLIENT_ID || "";
    google.GOOGLE_CLIENT_SECRET =
      process.env.GOOGLE_CLIENT_SECRET || values.GOOGLE_CLIENT_SECRET || "";
    try {
      for (const raw of (
        await readFile(resolve(".local/google.env"), "utf8")
      ).split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const split = line.indexOf("=");
        const key = line.slice(0, split);
        if (split < 1 || !Object.hasOwn(google, key))
          throw new Error(
            "Only GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET belong in .local/google.env",
          );
        google[key] = line.slice(split + 1).trim();
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const postgresPort = test ? 55433 : 55432;
  const redisPort = test ? 56380 : 56379;
  return {
    ...process.env,
    ...values,
    ...google,
    ...(await mediaEnvironment({ test })),
    POSTGRES_PORT: String(postgresPort),
    REDIS_PORT: String(redisPort),
    DATABASE_URL: `postgres://peerscreen_catalog:${values.CATALOG_DB_PASSWORD}@127.0.0.1:${postgresPort}/peerscreen?sslmode=disable`,
    REDIS_URL: `redis://:${values.REDIS_PASSWORD}@127.0.0.1:${redisPort}/0`,
    APP_ENV: "development",
    PEER_STUN_URLS: test
      ? ""
      : process.env.PEER_STUN_URLS || values.PEER_STUN_URLS || "",
    EXPOSE_OPERATOR_FIXTURE: test
      ? "true"
      : process.env.EXPOSE_OPERATOR_FIXTURE || "false",
    APP_ORIGIN: "http://localhost:3000",
    MEDIA_BASE_URL:
      process.env.MEDIA_BASE_URL || "http://localhost:3000/media/",
    TRACKER_URL: "ws://localhost:8000",
  };
}
