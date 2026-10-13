import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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
  const postgresPort = test ? 55433 : 55432;
  const redisPort = test ? 56380 : 56379;
  return {
    ...process.env,
    ...values,
    POSTGRES_PORT: String(postgresPort),
    REDIS_PORT: String(redisPort),
    DATABASE_URL: `postgres://peerscreen_catalog:${values.CATALOG_DB_PASSWORD}@127.0.0.1:${postgresPort}/peerscreen?sslmode=disable`,
    REDIS_URL: `redis://:${values.REDIS_PASSWORD}@127.0.0.1:${redisPort}/0`,
    APP_ENV: "development",
    APP_ORIGIN: "http://localhost:3000",
    MEDIA_BASE_URL:
      process.env.MEDIA_BASE_URL || "http://localhost:3000/media/",
    TRACKER_URL: "ws://localhost:8000",
  };
}
