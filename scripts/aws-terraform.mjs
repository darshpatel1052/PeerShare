import { randomBytes } from "node:crypto";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { awsEnvironment, awsRead } from "./aws-environment.mjs";

const run = promisify(execFile);
const directory = resolve(".local/aws/terraform");
const varsFile = resolve(directory, "inputs.tfvars.json");
const state = resolve(directory, "terraform.tfstate");
const planFile = resolve(directory, "deployment.tfplan");
const terraform = resolve(".local/tools/terraform");
const config = await awsEnvironment();
const operation = process.argv[2] || "plan";
await mkdir(directory, { recursive: true, mode: 0o700 });

async function assertAccount() {
  const [identity, plan] = await Promise.all([
    awsRead(["sts", "get-caller-identity"]),
    awsRead(["freetier", "get-account-plan-state"], { region: "us-east-1" }),
  ]);
  if (
    identity.Account !== config.settings.AWS_ACCOUNT_ID ||
    plan.accountPlanType !== "FREE" ||
    plan.accountPlanStatus !== "ACTIVE" ||
    plan.accountPlanRemainingCredits?.amount < 10
  )
    throw new Error(
      "Deployment requires the configured account, active Free plan and at least USD 10 remaining credits",
    );
  const marker = resolve(directory, "account.txt");
  try {
    if ((await readFile(marker, "utf8")).trim() !== identity.Account)
      throw new Error("Private deployment state belongs to another account");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(marker, identity.Account + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  }
  return plan;
}

async function prepare() {
  await assertAccount();
  try {
    await access(varsFile);
    return;
  } catch {}
  const sshDirectory = resolve(".local/aws/ssh");
  await mkdir(sshDirectory, { recursive: true, mode: 0o700 });
  const key = resolve(sshDirectory, "id_ed25519");
  try {
    await access(key);
  } catch {
    await run("ssh-keygen", [
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      "peerscreen-showcase",
      "-f",
      key,
    ]);
  }
  await chmod(key, 0o600);
  const ip = (
    await (
      await fetch("https://checkip.amazonaws.com/", {
        signal: AbortSignal.timeout(10000),
      })
    ).text()
  ).trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip))
    throw new Error("An IPv4 /32 is required for SSH");
  const duration = Number(config.settings.DEMO_DURATION_HOURS || 24);
  if (!Number.isInteger(duration) || duration < 1 || duration > 72)
    throw new Error("Demo duration must be 1–72 hours");
  await writeFile(
    varsFile,
    JSON.stringify(
      {
        region: config.settings.AWS_REGION,
        app_domain: config.settings.APP_DOMAIN,
        admin_cidr: `${ip}/32`,
        ssh_key_name: "peerscreen-showcase",
        ssh_public_key: (await readFile(key + ".pub", "utf8")).trim(),
        origin_secret: randomBytes(32).toString("hex"),
        demo_hours: duration,
        release_sha: "bootstrap",
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  console.log("Prepared private Terraform inputs and the deployment SSH key.");
}
async function tf(args, timeout = 120000) {
  const result = await run(terraform, ["-chdir=deploy/terraform", ...args], {
    env: config.env,
    maxBuffer: 16 * 1024 * 1024,
    timeout,
  });
  await chmod(state, 0o600).catch(() => {});
  return result.stdout;
}
try {
  if (operation === "prepare") await prepare();
  else if (operation === "plan") {
    await prepare();
    const log = await tf([
      "plan",
      "-input=false",
      `-state=${state}`,
      `-var-file=${varsFile}`,
      `-out=${planFile}`,
    ]);
    await writeFile(resolve(directory, "plan.txt"), log, { mode: 0o600 });
    const plan = JSON.parse(await tf(["show", "-json", planFile]));
    const changes = (plan.resource_changes || [])
      .filter(
        (item) =>
          item.mode === "managed" && item.change.actions.join() !== "no-op",
      )
      .map((item) => ({ address: item.address, actions: item.change.actions }));
    await writeFile(
      resolve(directory, "resource-summary.json"),
      JSON.stringify(changes, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify(
        {
          resources: changes.length,
          creations: changes.filter((item) => item.actions.includes("create"))
            .length,
          deletions: changes.filter((item) => item.actions.includes("delete"))
            .length,
          resourcesByType: Object.fromEntries(
            [...new Set(changes.map((item) => item.address.split(".")[0]))].map(
              (type) => [
                type,
                changes.filter((item) => item.address.startsWith(type + "."))
                  .length,
              ],
            ),
          ),
        },
        null,
        2,
      ),
    );
  } else if (operation === "certificate") {
    await prepare();
    await assertAccount();
    const log = await tf([
      "apply",
      "-input=false",
      "-auto-approve",
      "-target=aws_acm_certificate.frontend",
      `-state=${state}`,
      `-var-file=${varsFile}`,
    ]);
    await writeFile(resolve(directory, "certificate-apply.txt"), log, {
      mode: 0o600,
    });
    const outputs = JSON.parse(
      await tf(["output", "-json", `-state=${state}`]),
    );
    console.log(
      JSON.stringify(
        { certificateDNS: outputs.certificate_dns_records?.value },
        null,
        2,
      ),
    );
  } else if (operation === "foundation") {
    await prepare();
    const targets = [
      "aws_s3_bucket.storage",
      "aws_s3_bucket_public_access_block.storage",
      "aws_s3_bucket_server_side_encryption_configuration.storage",
      "aws_s3_bucket_lifecycle_configuration.originals",
      "aws_s3_bucket_lifecycle_configuration.backups",
      "aws_ecr_repository.images",
      "aws_ecr_lifecycle_policy.images",
      "aws_cloudwatch_log_group.app",
      "aws_iam_instance_profile.host",
      ...["host", "catalogue", "worker", "coordinator", "backup", "build"].map(
        (name) => "aws_iam_role_policy." + name,
      ),
    ];
    const log = await tf(
      [
        "apply",
        "-input=false",
        "-auto-approve",
        ...targets.map((target) => "-target=" + target),
        `-state=${state}`,
        `-var-file=${varsFile}`,
      ],
      600000,
    );
    await writeFile(resolve(directory, "foundation-apply.txt"), log, {
      mode: 0o600,
    });
    console.log(
      "Created private storage, immutable image repositories and scoped roles. Compute and CloudFront have not been provisioned by this operation.",
    );
  } else if (operation === "apply") {
    await prepare();
    const inputs = JSON.parse(await readFile(varsFile, "utf8"));
    if (!/^[a-f0-9]{40}$/.test(inputs.release_sha))
      throw new Error(
        "Publish a full commit release before provisioning compute",
      );
    const outputs = JSON.parse(
      await tf(["output", "-json", `-state=${state}`]),
    );
    for (const repository of Object.values(outputs.image_repositories.value))
      await awsRead([
        "ecr",
        "describe-images",
        "--repository-name",
        repository.split("/").slice(1).join("/"),
        "--image-ids",
        "imageTag=" + inputs.release_sha,
      ]);
    await awsRead([
      "s3api",
      "head-object",
      "--bucket",
      outputs.private_buckets.value.frontend,
      "--key",
      `releases/${inputs.release_sha}/index.html`,
    ]);
    const planLog = await tf([
      "plan",
      "-input=false",
      `-state=${state}`,
      `-var-file=${varsFile}`,
      `-out=${planFile}`,
    ]);
    await writeFile(resolve(directory, "plan.txt"), planLog, { mode: 0o600 });
    await chmod(planFile, 0o600);
    const proposed = JSON.parse(await tf(["show", "-json", planFile]));
    if (
      (proposed.resource_changes || []).some((item) =>
        item.change.actions.includes("delete"),
      )
    )
      throw new Error(
        "Deployment plan includes deletion; inspect it before proceeding",
      );
    await assertAccount();
    const log = await tf(["apply", "-input=false", planFile], 2700000);
    await writeFile(resolve(directory, "deployment-apply.txt"), log, {
      mode: 0o600,
    });
    console.log(
      "Applied the published release infrastructure. Origin DNS, certificate and data/application rollout still need verification.",
    );
  } else if (operation === "outputs") {
    const outputs = JSON.parse(
      await tf(["output", "-json", `-state=${state}`]),
    );
    await writeFile(
      resolve(directory, "outputs.json"),
      JSON.stringify(outputs, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(outputs)
            .filter(([key]) =>
              [
                "public_ip",
                "origin_domain",
                "certificate_dns_records",
                "cloudfront_domain",
                "cloudfront_id",
              ].includes(key),
            )
            .map(([key, item]) => [key, item.value]),
        ),
        null,
        2,
      ),
    );
  } else
    throw new Error(
      "Use prepare, plan, certificate, foundation, apply or outputs",
    );
} catch (error) {
  // Provider diagnostics remain in a private local file; state/plan can contain
  // the private CloudFront origin header and must never become CI artifacts.
  await writeFile(
    resolve(directory, "last-error.txt"),
    String(error.stderr || error.message),
    { mode: 0o600 },
  );
  console.error(
    "Terraform operation failed. Inspect the private deployment diagnostic file.",
  );
  process.exitCode = 1;
}
