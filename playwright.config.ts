import { defineConfig } from "@playwright/test";

/**
 * Playwright config for the *fixture-backed* end-to-end specs. These specs load
 * local HTML fixtures (file:// pages that mimic Copper's DOM) so they run in CI
 * without any live Copper access. They do NOT hit app.copper.com.
 *
 * Live validation against the real Copper UI is a manual step — see the README
 * "Manual live-validation checklist".
 */
export default defineConfig({
  testDir: "./src/tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
