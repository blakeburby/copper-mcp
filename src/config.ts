/**
 * Central configuration. Parsed once from environment variables with safe
 * defaults. Deliberately contains NO Copper credentials — authentication happens
 * interactively in the browser and is persisted in the profile directory.
 */
import { resolve } from "node:path";

export type LogLevel = "error" | "warn" | "info" | "debug";

export interface CopperConfig {
  /**
   * When true, the write tools (log_activity, create_task) are NOT registered,
   * and the underlying page-object mutations throw on entry. Defaults to true
   * because "you have to opt in to writing" is a much safer default than
   * "you have to remember not to". Set COPPER_READ_ONLY=false to enable writes.
   */
  readOnly: boolean;
  /**
   * Network write guard: "off" | "audit" | "block". In read-only mode this
   * defaults to "block" — mutating HTTP requests to Copper are aborted at the
   * network layer, the strongest guarantee available when the login has full
   * write rights and a read-only Copper user isn't an option.
   */
  writeGuard: "off" | "audit" | "block";
  /** Base URL of the Copper web app, e.g. https://app.copper.com */
  baseUrl: string;
  /** Absolute path to the persistent browser profile directory. */
  userDataDir: string;
  /** Whether to run the browser headless. First-time login must be headed. */
  headless: boolean;
  /** Default per-action timeout (ms) for locator waits / clicks. */
  defaultTimeoutMs: number;
  /** Navigation timeout (ms) for goto / waitForURL. */
  navigationTimeoutMs: number;
  /** Absolute path to the directory for failure screenshots / HTML snapshots. */
  screenshotDir: string;
  /** Log verbosity. */
  logLevel: LogLevel;
  /**
   * Playwright browser channel, e.g. "chrome" to drive the real installed
   * Google Chrome instead of Playwright's bundled Chromium. Some apps do not
   * render correctly in the bundled build (it runs with software rendering and
   * a large set of disabled features), so this is the first thing to try when a
   * page loads its third-party widgets but never boots its own app.
   * Undefined = bundled Chromium.
   */
  browserChannel?: string;
}

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

/**
 * Safety-critical version of envBool: it only accepts values we RECOGNISE, and
 * falls back to the safe default for anything else. Typo-resistant, so setting
 * COPPER_READ_ONLY=flase (misspelled) cannot silently disable the lock.
 */
function envBoolStrict(value: string | undefined, safeDefault: boolean): boolean {
  if (value === undefined) return safeDefault;
  const v = value.trim().toLowerCase();
  if (/^(1|true|yes|on)$/.test(v)) return true;
  if (/^(0|false|no|off)$/.test(v)) return false;
  return safeDefault;
}

function envInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  const allowed: LogLevel[] = ["error", "warn", "info", "debug"];
  if (value && (allowed as string[]).includes(value)) return value as LogLevel;
  return fallback;
}

function parseWriteGuard(
  value: string | undefined,
  readOnly: boolean,
): "off" | "audit" | "block" {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "off" || v === "audit" || v === "block") return v;
  // Unset: in read-only mode block by default (belt-and-braces beneath the DOM
  // lock); when writes are enabled, don't interfere with them.
  return readOnly ? "block" : "off";
}

let cached: CopperConfig | undefined;

/** Build (and memoize) the config from the current environment. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): CopperConfig {
  if (cached) return cached;

  const baseUrl = (env.COPPER_BASE_URL ?? "https://app.copper.com").replace(
    /\/+$/,
    "",
  );

  const readOnly = envBoolStrict(env.COPPER_READ_ONLY, true);

  cached = {
    baseUrl,
    userDataDir: resolve(env.COPPER_USER_DATA_DIR ?? "./.copper-profile"),
    headless: envBool(env.COPPER_HEADLESS, false),
    defaultTimeoutMs: envInt(env.COPPER_DEFAULT_TIMEOUT_MS, 30_000),
    navigationTimeoutMs: envInt(env.COPPER_NAVIGATION_TIMEOUT_MS, 45_000),
    screenshotDir: resolve(
      env.COPPER_SCREENSHOT_DIR ?? "./artifacts/screenshots",
    ),
    logLevel: envLogLevel(env.LOG_LEVEL, "info"),
    readOnly,
    writeGuard: parseWriteGuard(env.COPPER_WRITE_GUARD, readOnly),
    browserChannel: env.COPPER_BROWSER_CHANNEL?.trim() || undefined,
  };

  return cached;
}

/** Test helper: clear the memoized config so a fresh env can be parsed. */
export function resetConfigCache(): void {
  cached = undefined;
}
