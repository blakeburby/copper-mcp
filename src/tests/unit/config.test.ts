import { describe, it, expect, beforeEach } from "vitest";
import { loadConfig, resetConfigCache } from "../../config.js";

describe("loadConfig", () => {
  beforeEach(() => resetConfigCache());

  it("applies safe defaults with an empty environment", () => {
    const cfg = loadConfig({});
    expect(cfg.baseUrl).toBe("https://app.copper.com");
    expect(cfg.headless).toBe(false);
    expect(cfg.defaultTimeoutMs).toBe(30_000);
    expect(cfg.navigationTimeoutMs).toBe(45_000);
    expect(cfg.logLevel).toBe("info");
  });

  it("never requires or reads a Copper API key", () => {
    const cfg = loadConfig({ COPPER_API_KEY: "should-be-ignored" } as NodeJS.ProcessEnv);
    expect(Object.values(cfg)).not.toContain("should-be-ignored");
    expect("apiKey" in cfg).toBe(false);
  });

  it("parses overrides and strips trailing slashes from baseUrl", () => {
    const cfg = loadConfig({
      COPPER_BASE_URL: "https://example.copper.com/",
      COPPER_HEADLESS: "true",
      COPPER_DEFAULT_TIMEOUT_MS: "5000",
      LOG_LEVEL: "debug",
    } as NodeJS.ProcessEnv);
    expect(cfg.baseUrl).toBe("https://example.copper.com");
    expect(cfg.headless).toBe(true);
    expect(cfg.defaultTimeoutMs).toBe(5000);
    expect(cfg.logLevel).toBe("debug");
  });

  it("falls back to defaults for invalid numbers and log levels", () => {
    const cfg = loadConfig({
      COPPER_DEFAULT_TIMEOUT_MS: "not-a-number",
      LOG_LEVEL: "verbose",
    } as NodeJS.ProcessEnv);
    expect(cfg.defaultTimeoutMs).toBe(30_000);
    expect(cfg.logLevel).toBe("info");
  });
});
