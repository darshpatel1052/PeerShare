import { access } from "node:fs/promises";
import { compose } from "./dependencies.mjs";

export async function startContainerApp({ test = false } = {}) {
  await access(".local/media/fixture/fixture.json");
  // Build before interrupting playback. Stop writers before migration/seed tasks
  // import unfinished work; an old executor must not race that import.
  await compose(["--profile", "app", "build", "web", "migrate"], { test });
  await compose(["--profile", "app", "stop", "web", "api", "worker", "media"], {
    test,
  });
  await compose(
    [
      "--profile",
      "app",
      "up",
      "-d",
      "--no-build",
      "--wait",
      "--wait-timeout",
      "120",
      "web",
      "worker",
    ],
    { test },
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    await startContainerApp();
    console.log(
      `Containerized PeerScreen is ready at http://localhost:${process.env.PEERSCREEN_WEB_PORT || "3000"}.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
