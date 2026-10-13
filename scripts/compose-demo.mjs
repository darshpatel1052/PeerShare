import { access } from "node:fs/promises";
import { compose } from "./dependencies.mjs";
try {
  await access(".local/media/fixture/fixture.json");
  await compose([
    "--profile",
    "app",
    "up",
    "-d",
    "--build",
    "--wait",
    "--wait-timeout",
    "90",
    "web",
    "worker",
  ]);
  console.log("Containerized PeerScreen is ready at http://localhost:3000.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
