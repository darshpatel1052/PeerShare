import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export async function awsEnvironment() {
  const file = resolve(".local/aws-deployment.env");
  if ((await stat(file)).mode & 0o077)
    throw new Error("AWS deployment settings must have mode 0600");
  const settings = {};
  for (const raw of (await readFile(file, "utf8")).split("\n")) {
    const line = raw.trim().replace(/^export /, "");
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) throw new Error("Invalid deployment setting syntax");
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    settings[match[1]] = value;
  }
  const env = { ...process.env, AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" };
  for (const key of [
    "AWS_PROFILE",
    "AWS_REGION",
    "AWS_CONFIG_FILE",
    "AWS_SHARED_CREDENTIALS_FILE",
    "AWS_LOGIN_CACHE_DIRECTORY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
  ])
    if (settings[key]) env[key] = settings[key];
  return {
    settings,
    env,
    cli: settings.AWS_CLI || resolve(".local/tools/bin/aws"),
  };
}

// Callers choose output fields; never invoke export-credentials or --debug here.
export async function awsRead(args, { region } = {}) {
  const config = await awsEnvironment();
  const { stdout } = await run(
    config.cli,
    [
      ...args,
      "--output",
      "json",
      "--no-cli-pager",
      ...(region ? ["--region", region] : []),
    ],
    {
      env: config.env,
      timeout: 45000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}
