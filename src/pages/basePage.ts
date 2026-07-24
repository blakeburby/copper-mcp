/**
 * Base page object. Wraps a Playwright Page with:
 *  - selector resolution (primary → fallback → descriptive SELECTOR_FAILURE)
 *  - locator/URL/network-based waits (no arbitrary sleeps)
 *  - dialog handling
 *  - safe text extraction
 *  - retryable idempotent reads with exponential backoff
 *
 * Concrete page objects (peoplePage, etc.) extend this.
 */
import type { Page, Locator, Dialog } from "playwright";
import { loadConfig } from "../config.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { retryAsync } from "../utils/retry.js";
import { errors, CopperToolError } from "../types/errors.js";
import { captureDiagnostics } from "../browser/diagnostics.js";
import {
  globalSearch,
  list,
  routes,
  type Scope,
  type SelectorEntry,
} from "../selectors/copperSelectors.js";

export class BasePage {
  protected readonly cfg = loadConfig();

  constructor(
    protected readonly page: Page,
    protected readonly log: Logger = createLogger(),
  ) {
    // Auto-dismiss unexpected native dialogs so they can't wedge automation.
    this.page.on("dialog", (dialog: Dialog) => {
      this.log.warn("Auto-dismissing native dialog", {
        type: dialog.type(),
        message: dialog.message(),
      });
      void dialog.dismiss().catch(() => undefined);
    });
  }

  /** The per-selector visibility budget (kept short so fallbacks kick in fast). */
  private get selectorTimeout(): number {
    return Math.min(this.cfg.defaultTimeoutMs, 8_000);
  }

  /**
   * Resolve a selector entry: try the primary, then the fallback. Returns the
   * matching (possibly multi-element) Locator, or throws SELECTOR_FAILURE.
   */
  async resolve(
    entry: SelectorEntry,
    opts: { scope?: Scope; timeout?: number } = {},
  ): Promise<Locator> {
    const scope = opts.scope ?? this.page;
    const timeout = opts.timeout ?? this.selectorTimeout;

    const primary = entry.primary(scope);
    try {
      await primary.first().waitFor({ state: "visible", timeout });
      return primary;
    } catch {
      this.log.debug(`Primary selector missed: ${entry.description}; trying fallback.`);
    }

    const fallback = entry.fallback(scope);
    try {
      await fallback.first().waitFor({ state: "visible", timeout });
      this.log.debug(`Fallback selector matched: ${entry.description}.`);
      return fallback;
    } catch {
      throw errors.selector(
        entry.description,
        `Neither primary nor fallback selector for "${entry.description}" became visible within ${timeout}ms.` +
          (entry.verified ? "" : " (This selector is UNVERIFIED against the live Copper UI.)"),
      );
    }
  }

  /** Like resolve() but returns null instead of throwing (for optional fields). */
  async tryResolve(
    entry: SelectorEntry,
    opts: { scope?: Scope; timeout?: number } = {},
  ): Promise<Locator | null> {
    try {
      return await this.resolve(entry, { ...opts, timeout: opts.timeout ?? 3_000 });
    } catch {
      return null;
    }
  }

  /**
   * Resolve the account-scoped app base URL, e.g.
   * https://app.copper.com/companies/{accountId}/app. The account id is read from
   * the current URL; if we're not on the app shell yet, navigate to the base URL
   * (which redirects to the shell when authenticated) and read it from there.
   */
  async appBaseUrl(): Promise<string> {
    let match = this.page.url().match(routes.appShellUrl);
    if (!match) {
      await this.gotoPath(this.cfg.baseUrl);
      await this.page
        .waitForURL(routes.appShellUrl, { timeout: this.cfg.navigationTimeoutMs })
        .catch(() => undefined);
      match = this.page.url().match(routes.appShellUrl);
    }
    if (!match) {
      throw errors.auth(
        "Could not resolve the Copper account app URL (not on the authenticated app shell).",
      );
    }
    return `${this.cfg.baseUrl}/companies/${match[1]}/app`;
  }

  /**
   * Navigate to an in-app hash route (e.g. "#/browse/list/people/default"). When
   * only the hash differs from the current URL we set location.hash directly so
   * the SPA router reacts (page.goto would not reload a same-document hash change).
   */
  async gotoAppRoute(hash: string): Promise<void> {
    const full = `${await this.appBaseUrl()}${hash}`;
    const samePath = this.page.url().split("#")[0] === full.split("#")[0];
    if (samePath) {
      await this.page.evaluate((h) => {
        window.location.hash = h;
      }, hash);
    } else {
      await this.gotoPath(full);
    }
    await this.waitForSettled();
  }

  /** Navigate to an app path (relative to the configured base URL). */
  async gotoPath(path: string): Promise<void> {
    const url = path.startsWith("http")
      ? path
      : `${this.cfg.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    await retryAsync(
      async () => {
        await this.page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.cfg.navigationTimeoutMs,
        });
      },
      {
        retries: 2,
        baseDelayMs: 500,
        onRetry: (err, attempt, delay) =>
          this.log.warn(`Navigation retry ${attempt} after ${delay}ms`, {
            url,
            error: err instanceof Error ? err.message : String(err),
          }),
      },
    ).catch((err) => {
      throw errors.navigation(
        `Could not load ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /** Wait until the page settles (network idle-ish) without a fixed sleep. */
  async waitForSettled(): Promise<void> {
    try {
      await this.page.waitForLoadState("networkidle", {
        timeout: this.cfg.defaultTimeoutMs,
      });
    } catch {
      // networkidle can be flaky on SPAs with long-poll connections; fall back
      // to domcontentloaded which will already have fired.
      this.log.debug("networkidle wait timed out; continuing.");
    }
  }

  /** Safe innerText for a locator; returns null if missing/empty. */
  async textOf(locator: Locator | null): Promise<string | null> {
    if (!locator) return null;
    try {
      const raw = (await locator.first().innerText({ timeout: 2_000 })).trim();
      return raw.length ? raw : null;
    } catch {
      return null;
    }
  }

  /** Safe attribute read; returns null if missing. */
  async attrOf(locator: Locator | null, name: string): Promise<string | null> {
    if (!locator) return null;
    try {
      return await locator.first().getAttribute(name, { timeout: 2_000 });
    } catch {
      return null;
    }
  }

  /**
   * Run an idempotent read with retries + backoff. Never use for writes.
   * Captures diagnostics on the final failure.
   */
  async read<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await retryAsync((attempt) => {
        this.log.debug(`read "${label}" attempt ${attempt + 1}`);
        return fn();
      }, {
        retries: 2,
        baseDelayMs: 400,
        // Don't waste retries on auth failures — those won't fix themselves.
        shouldRetry: (err) =>
          !(err instanceof CopperToolError && err.code === "AUTHENTICATION_REQUIRED"),
      });
    } catch (err) {
      const diag = await captureDiagnostics(this.page, `read_${label}`, {
        includeHtml: true,
        logger: this.log,
      });
      if (err instanceof CopperToolError) {
        err.artifactPath = diag.screenshotPath;
        throw err;
      }
      const wrapped = errors.unexpectedUi(
        `Read "${label}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      wrapped.artifactPath = diag.screenshotPath;
      throw wrapped;
    }
  }

  get raw(): Page {
    return this.page;
  }

  /**
   * Type a query into the global search box and submit. Best-effort: resolves the
   * search input via primary/fallback selectors.
   */
  async fillGlobalSearch(query: string): Promise<void> {
    const input = await this.resolve(globalSearch.input);
    await input.first().click();
    await input.first().fill(query);
    await input.first().press("Enter");
    await this.waitForSettled();
  }

  /**
   * Collect up to `limit` result rows as { name, href } pairs from a list/table.
   * Returns [] if the empty-state indicator is showing.
   */
  async collectRowLinks(limit: number): Promise<Array<{ name: string | null; href: string | null }>> {
    // Short-circuit on an explicit empty state.
    const empty = await this.tryResolve(list.emptyState, { timeout: 1_500 });
    if (empty) return [];

    let rows: Locator;
    try {
      rows = await this.resolve(list.rows);
    } catch {
      // No rows and no empty-state marker: treat as no results rather than error.
      return [];
    }

    const count = Math.min(await rows.count(), limit);
    const out: Array<{ name: string | null; href: string | null }> = [];
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const link = list.rowLink.primary(row).first();
      const linkFb = list.rowLink.fallback(row).first();
      const active = (await link.count().catch(() => 0)) ? link : linkFb;
      const name = await this.textOf(active).catch(() => null);
      const href = await this.attrOf(active, "href").catch(() => null);
      out.push({ name, href: this.absolutize(href) });
    }
    return out;
  }

  /** Turn a relative href into an absolute Copper URL. */
  protected absolutize(href: string | null): string | null {
    if (!href) return null;
    if (href.startsWith("http")) return href;
    return `${this.cfg.baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
  }

  /** Extract a stable record id from a Copper record URL, if present. */
  protected idFromUrl(url: string | null): string | null {
    if (!url) return null;
    const m = url.match(/\/(\d+)(?:[/?#]|$)/);
    return m ? m[1] : null;
  }
}
