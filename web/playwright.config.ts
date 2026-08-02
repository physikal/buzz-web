import { defineConfig, devices } from "@playwright/test";

const port = process.env.BUZZ_WEB_TEST_PORT ?? "4173";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "smoke",
      testMatch: ["**/smoke.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort --host 127.0.0.1`,
    cwd: ".",
    reuseExistingServer: !process.env.CI,
    url: baseURL,
  },
});
