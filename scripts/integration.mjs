import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compose } from "./dependencies.mjs";
import { localEnvironment } from "./local-environment.mjs";
import { runGo } from "./go.mjs";

try {
  await compose(["up", "-d", "--wait", "--wait-timeout", "60"], { test: true });
  const environment = {
    ...(await localEnvironment({ test: true })),
    PEERSCREEN_INTEGRATION: "true",
  };
  const output = await runGo(
    ["test", "-race", "-count=1", "-json", "./..."],
    environment,
    { json: true },
  );
  await mkdir(resolve(".local/evidence"), { recursive: true });
  await writeFile(resolve(".local/evidence/phase-1-go-tests.jsonl"), output);
  const events = output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const event of events.filter(
    (event) => event.Action === "pass" && event.Test,
  ))
    console.log(`PASS ${event.Test} (${event.Elapsed}s)`);
  if (
    events.some(
      (event) => event.Action === "skip" && event.Test?.includes("Integration"),
    )
  )
    throw new Error("Integration tests were skipped unexpectedly");
} catch (error) {
  if (error.output) {
    await mkdir(resolve(".local/evidence"), { recursive: true });
    await writeFile(
      resolve(".local/evidence/phase-1-go-tests.jsonl"),
      error.output,
    );
    for (const line of error.output.trim().split("\n")) {
      const event = JSON.parse(line);
      if (event.Action === "output") process.stderr.write(event.Output);
    }
  }
  console.error(error.message);
  process.exitCode = 1;
} finally {
  // Only the separate disposable test project is removed. The application's volume is preserved.
  await compose(["down", "--volumes"], { test: true, quiet: true }).catch(
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
