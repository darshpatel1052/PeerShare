import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function mediaEnvironment({ test = false } = {}) {
  const path = resolve(".local/media.env");
  const keys = ["MEDIA_DB_PASSWORD", "CATALOG_RPC_TOKEN", "WORKER_RPC_TOKEN"];
  try {
    await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(resolve(".local"), { recursive: true });
    const contents =
      keys
        .map((key) => `${key}=${randomBytes(32).toString("hex")}`)
        .join("\n") + "\n";
    try {
      await writeFile(path, contents, { mode: 0o600, flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  const values = Object.fromEntries(
    (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const split = line.indexOf("=");
        return [line.slice(0, split), line.slice(split + 1)];
      }),
  );
  if (
    Object.keys(values).length !== keys.length ||
    keys.some((key) => !/^[a-f0-9]{64}$/.test(values[key])) ||
    values.CATALOG_RPC_TOKEN === values.WORKER_RPC_TOKEN
  )
    throw new Error("Invalid private media configuration in .local/media.env");
  const postgres = test ? 55433 : 55432;
  const kafka = test ? 19093 : 19092;
  return {
    ...values,
    MEDIA_DATABASE_URL: `postgres://peerscreen_media:${values.MEDIA_DB_PASSWORD}@127.0.0.1:${postgres}/peerscreen?sslmode=disable`,
    KAFKA_PORT: String(kafka),
    KAFKA_BOOTSTRAP_SERVERS: `127.0.0.1:${kafka}`,
  };
}
