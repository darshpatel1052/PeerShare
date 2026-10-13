import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: ".local/browser-results.json" }],
  ],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    browserName: "chromium",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  webServer: {
    command: "npm run demo",
    env: {
      PEERSCREEN_TEST_RUNTIME: "true",
      DEMO_PORT: "3100",
      MEDIA_PORT: "3101",
      TRACKER_PORT: "8100",
      API_LISTEN_ADDR: "127.0.0.1:8081",
    },
    url: "http://localhost:3100",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 20_000 },
    timeout: 120_000,
  },
});
