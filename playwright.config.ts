import { defineConfig, devices } from "@playwright/test";

const defaultBaseURL = "http://localhost:3000";
const baseURL = process.env.E2E_BASE_URL || defaultBaseURL;
const shouldStartWebServer =
  process.env.E2E_SKIP_WEB_SERVER !== "1" && !process.env.E2E_BASE_URL;
const storageState = process.env.E2E_STORAGE_STATE || undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    storageState,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: shouldStartWebServer
    ? {
        command: "npm run dev",
        url: defaultBaseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
