import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests only. Playwright e2e specs live in src/tests/e2e and are run
    // via `npm run test:e2e`, not vitest.
    include: ["src/tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
