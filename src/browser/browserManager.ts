/**
 * Centralized Playwright browser manager.
 *
 * Responsibilities:
 *  - Own ONE persistent Chromium context (launchPersistentContext) so the logged-in
 *    Copper session is reused across MCP requests — we never launch a browser per call.
 *  - Reuse a single page when safe.
 *  - Detect disconnection / crashes and relaunch cleanly on next use.
 *  - Close gracefully when the MCP server process exits.
 *  - Serialize mutations via a mutex so two writes can't collide on the shared page.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdir, chmod } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { rootLogger } from "../utils/logger.js";
import { Mutex } from "../utils/mutex.js";
import { errors } from "../types/errors.js";
import { installWriteGuard, type WriteGuardStats } from "./writeGuard.js";

export class BrowserManager {
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private launching: Promise<BrowserContext> | undefined;
  private disconnected = false;
  private closing = false;
  readonly mutationLock = new Mutex();
  /** Populated when the network write guard is installed. */
  writeGuardStats?: WriteGuardStats;

  /** Navigations since the shared page was last recycled (heap-growth bound). */
  private navCount = 0;
  /**
   * Recycle the shared page after this many navigations. A bulk sync drives one
   * long-lived page through thousands of SPA route changes; recycling bounds the
   * accumulated DOM/JS heap. Safe because getPage's consumers all re-navigate
   * (assertAuthenticated → appHome) before using the page, so a fresh blank page
   * is never used as-is.
   */
  private static readonly RECYCLE_EVERY = 250;

  /** Count a navigation toward the recycle threshold (called by page objects). */
  noteNavigation(): void {
    this.navCount++;
  }

  /** Is a live, connected context currently held? */
  isRunning(): boolean {
    return !!this.context && !this.disconnected;
  }

  /**
   * Ensure a connected persistent context exists, launching (or relaunching after
   * a crash) if needed. Concurrent callers share a single in-flight launch.
   */
  async ensureContext(headlessOverride?: boolean): Promise<BrowserContext> {
    if (this.context && !this.disconnected) return this.context;
    if (this.launching) return this.launching;

    this.launching = this.launch(headlessOverride).finally(() => {
      this.launching = undefined;
    });
    return this.launching;
  }

  private async launch(headlessOverride?: boolean): Promise<BrowserContext> {
    const cfg = loadConfig();
    await mkdir(cfg.userDataDir, { recursive: true });
    // The profile holds a LIVE authenticated CRM session — on a client
    // engagement, the client's session. Owner-only access, every launch (not
    // just creation), so a copied or migrated profile does not keep loose modes.
    await chmod(cfg.userDataDir, 0o700).catch((err) => {
      rootLogger.warn("Could not restrict profile directory permissions", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    const headless = headlessOverride ?? cfg.headless;
    rootLogger.info("Launching persistent browser context", {
      userDataDir: cfg.userDataDir,
      headless,
      channel: cfg.browserChannel ?? "bundled-chromium",
    });

    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(cfg.userDataDir, {
        headless,
        viewport: { width: 1440, height: 900 },
        args: ["--disable-blink-features=AutomationControlled"],
        // When set (e.g. "chrome"), Playwright drives the real installed
        // browser rather than its bundled Chromium build.
        ...(cfg.browserChannel ? { channel: cfg.browserChannel } : {}),
      });
    } catch (err) {
      throw errors.browser(
        `Failed to launch Chromium. Did you run "npm run install:browsers"? ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    context.setDefaultTimeout(cfg.defaultTimeoutMs);
    context.setDefaultNavigationTimeout(cfg.navigationTimeoutMs);

    this.disconnected = false;
    context.on("close", () => {
      if (!this.closing) {
        rootLogger.warn("Browser context closed unexpectedly; will relaunch on next use.");
      }
      this.disconnected = true;
      this.context = undefined;
      this.page = undefined;
    });

    // Network write guard — the backstop beneath the DOM read-only lock.
    this.writeGuardStats = await installWriteGuard(context, cfg.writeGuard, rootLogger);

    this.context = context;
    // Reuse the initial page persistent context opens with, if any.
    this.page = context.pages()[0] ?? (await context.newPage());
    return context;
  }

  /** Get the shared, reused page (creating one if necessary). */
  async getPage(headlessOverride?: boolean): Promise<Page> {
    const context = await this.ensureContext(headlessOverride);

    // Periodically retire the shared page to bound heap growth over long runs.
    // Only when a mutation is NOT in flight (writes hold the lock and keep the
    // page reference), and the replacement is a fresh blank page that the next
    // assertAuthenticated will navigate to Copper before use.
    if (
      this.page &&
      !this.page.isClosed() &&
      this.navCount >= BrowserManager.RECYCLE_EVERY &&
      !this.mutationLock.isLocked
    ) {
      rootLogger.info(`Recycling shared page after ${this.navCount} navigations to bound memory.`);
      const old = this.page;
      this.page = await context.newPage();
      this.navCount = 0;
      await old.close().catch(() => undefined);
      return this.page;
    }

    if (this.page && !this.page.isClosed()) return this.page;
    this.page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());
    return this.page;
  }

  /** Run `fn` while holding the mutation lock (for writes). */
  async withMutation<T>(fn: () => Promise<T>): Promise<T> {
    return this.mutationLock.runExclusive(fn);
  }

  /** Force a clean relaunch (used after a crash is detected mid-operation). */
  async restart(): Promise<BrowserContext> {
    await this.close();
    this.disconnected = false;
    return this.ensureContext();
  }

  /** Gracefully close the context. Safe to call multiple times. */
  async close(): Promise<void> {
    this.closing = true;
    const ctx = this.context;
    this.context = undefined;
    this.page = undefined;
    if (ctx) {
      try {
        await ctx.close();
      } catch (err) {
        rootLogger.debug("Error while closing browser context (ignored).", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.closing = false;
  }
}

let singleton: BrowserManager | undefined;
let exitHooksInstalled = false;

/** Get (and lazily create) the process-wide BrowserManager singleton. */
export function getBrowserManager(): BrowserManager {
  if (!singleton) {
    singleton = new BrowserManager();
    installExitHooks(singleton);
  }
  return singleton;
}

function installExitHooks(manager: BrowserManager): void {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;

  const shutdown = async (signal: string) => {
    rootLogger.info(`Received ${signal}; closing browser and exiting.`);
    await manager.close();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("beforeExit", () => void manager.close());
}

/** Test helper: drop the singleton so a fresh one can be constructed. */
export function _resetBrowserManagerForTests(): void {
  singleton = undefined;
  exitHooksInstalled = false;
}
