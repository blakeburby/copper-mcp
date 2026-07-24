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
  auth,
  globalSearch,
  list,
  routes,
  type Scope,
  type SelectorEntry,
} from "../selectors/copperSelectors.js";

/**
 * How long a PRIMARY selector gets to prove itself before we fall back. Kept
 * short on purpose — see resolve().
 */
const PRIMARY_PROBE_MS = 2_000;

export class BasePage {
  protected readonly cfg = loadConfig();

  /** Ring buffer of the page's own console output and uncaught errors. */
  private readonly consoleBuffer: string[] = [];
  private static readonly MAX_CONSOLE = 300;

  constructor(
    protected readonly page: Page,
    protected readonly log: Logger = createLogger(),
  ) {
    const record = (line: string) => {
      this.consoleBuffer.push(`${new Date().toISOString()} ${line}`);
      if (this.consoleBuffer.length > BasePage.MAX_CONSOLE) this.consoleBuffer.shift();
    };
    this.page.on("console", (m) => record(`[console.${m.type()}] ${m.text()}`));
    this.page.on("pageerror", (e) => record(`[pageerror] ${e.message}`));
    this.page.on("requestfailed", (r) =>
      record(`[requestfailed] ${r.method()} ${r.url()} — ${r.failure()?.errorText ?? "?"}`),
    );

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
    opts: { scope?: Scope; timeout?: number; state?: "visible" | "attached" } = {},
  ): Promise<Locator> {
    const scope = opts.scope ?? this.page;
    const timeout = opts.timeout ?? this.selectorTimeout;
    // "attached" is for containers that legitimately render with zero height
    // when empty — an empty feed list is present but invisible, and demanding
    // visibility there would report a real empty state as a selector failure.
    const state = opts.state ?? "visible";

    // The primary gets a SHORTER probe than the fallback. A role/label-based
    // primary that is going to match a loaded page matches quickly; when it
    // cannot match at all (e.g. getByRole("row") against Copper's div-based
    // list, confirmed 2026-07-24) the full budget would otherwise be burned on
    // every call before the fallback even runs. Slow-rendering pages are covered
    // by waitForSettled() and read()'s retry-with-backoff, not by this wait.
    const primaryTimeout = Math.max(1_000, Math.min(timeout, PRIMARY_PROBE_MS));

    const primary = entry.primary(scope);
    try {
      await primary.first().waitFor({ state, timeout: primaryTimeout });
      return primary;
    } catch {
      this.log.debug(`Primary selector missed: ${entry.description}; trying fallback.`);
    }

    const fallback = entry.fallback(scope);
    try {
      await fallback.first().waitFor({ state, timeout });
      this.log.debug(`Fallback selector matched: ${entry.description}.`);
      return fallback;
    } catch {
      throw errors.selector(
        entry.description,
        `Neither primary (${primaryTimeout}ms) nor fallback (${timeout}ms) selector for "${entry.description}" became visible.` +
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
    // Boot the shell, WAIT for it to finish booting, and only then route.
    //
    // Copper uses ember-concurrency, and its route sync is a `drop` task: while
    // one transition is in flight, any new one is cancelled outright. Changing
    // the hash too early therefore kills the transition and leaves the app on a
    // spinner forever, with only this in the console:
    //
    //   Error while processing route: contact
    //   TaskInstance 'syncTask' was canceled because it belongs to a 'drop'
    //   Task that was already running.
    //
    // appBaseUrl() waits only for the URL to match, NOT for the app to be
    // usable — so the readiness wait below must happen unconditionally, not
    // just when we had to navigate.
    const base = await this.appBaseUrl();
    if (!this.page.url().startsWith(base)) {
      await this.gotoPath(base);
    }
    await this.waitForAppReady();

    await this.page.evaluate((h) => {
      window.location.hash = h;
    }, hash);
    await this.waitForSettled();
    // The hash change starts a fresh transition; let it finish before reading.
    await this.waitForAppReady();
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

  /**
   * Wait until Copper's SPA has actually rendered.
   *
   * Two things make this necessary, both learned from failure artifacts:
   *  - networkidle never fires (Intercom holds long-poll sockets open), so
   *    waitForSettled() returns while the app is still booting.
   *  - Waiting for a spinner to DISAPPEAR is the wrong shape: on a cold profile
   *    the spinner has not painted yet either, so "no spinner" is
   *    indistinguishable from "not started". An earlier version of this method
   *    made exactly that mistake and skipped waiting altogether.
   *
   * So wait for a POSITIVE signal — the authenticated app shell — which only
   * exists once Ember has hydrated. A cold profile downloads the whole bundle,
   * hence the generous budget.
   */
  async waitForAppReady(timeout = 60_000): Promise<boolean> {
    const shell = auth.appShell.primary(this.page).first();
    const shellFallback = auth.appShell.fallback(this.page).first();
    try {
      await Promise.race([
        shell.waitFor({ state: "visible", timeout }),
        shellFallback.waitFor({ state: "visible", timeout }),
      ]);
      return true;
    } catch {
      this.log.warn("Copper app shell did not render within budget — the SPA may still be booting.");
      return false;
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

  /**
   * Safe value read for Copper's inline-editable fields.
   *
   * Record-detail values are held in <input>/<textarea> VALUES, not text nodes
   * (verified 2026-07-24), so innerText returns "" for them — always use this
   * for record fields. Falls back to innerText for the read-only variants.
   */
  async valueOf(locator: Locator | null): Promise<string | null> {
    if (!locator) return null;
    try {
      const raw = (await locator.first().inputValue({ timeout: 2_000 })).trim();
      if (raw.length) return raw;
    } catch {
      // Not an input (Copper renders some fields read-only) — try text instead.
      return this.textOf(locator);
    }
    return null;
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
        consoleMessages: this.consoleBuffer,
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

  /** The page's buffered console output, for diagnostics. */
  get consoleMessages(): string[] {
    return [...this.consoleBuffer];
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
    // Look for rows FIRST: their presence is the positive signal, and it is the
    // common case. (Probing the empty state first would burn its full budget on
    // every populated search.)
    let rows: Locator;
    try {
      // The caller has already awaited waitForSettled(), so rows should be in the
      // DOM; a tighter budget keeps the zero-results path from dragging.
      rows = await this.resolve(list.rows, { timeout: 4_000 });
    } catch {
      // No rows. Distinguish a genuinely empty result set from a broken selector
      // so the logs say which one it was — both return [] to the caller.
      const empty = await this.tryResolve(list.emptyState, { timeout: 1_500 });
      this.log.debug(
        empty
          ? "No rows and an empty-state marker was present: zero results."
          : "No rows and NO empty-state marker: the row selector may be stale.",
      );
      return [];
    }

    // Scan every row but stop once `limit` RECORDS have been collected. The
    // header <tr> also matches getByRole("row") and carries no record link, so
    // capping the scan at `limit` would silently under-return.
    const total = await rows.count();
    const out: Array<{ name: string | null; href: string | null }> = [];
    for (let i = 0; i < total && out.length < limit; i++) {
      const row = rows.nth(i);
      const link = list.rowLink.primary(row).first();
      const linkFb = list.rowLink.fallback(row).first();
      const active = (await link.count().catch(() => 0)) ? link : linkFb;
      const href = await this.attrOf(active, "href").catch(() => null);

      // The link's own innerText also contains the avatar initial
      // ("J\nJim Halpert"), so prefer the dedicated name span and fall back to
      // the link text with the initial stripped.
      let name = await this.textOf(list.rowName.primary(row)).catch(() => null);
      if (!name) name = this.stripAvatarInitial(await this.textOf(active).catch(() => null));

      // A header row carries no record link — skip it rather than emit a blank.
      if (!href && !name) continue;
      out.push({ name, href: this.absolutize(href) });
    }
    return out;
  }

  /** Drop a leading single-letter avatar initial line, e.g. "J\nJim Halpert". */
  protected stripAvatarInitial(text: string | null): string | null {
    if (!text) return null;
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines[0].length === 1) lines.shift();
    return lines.join(" ").trim() || null;
  }

  /** Turn a relative href into an absolute Copper URL. */
  protected absolutize(href: string | null): string | null {
    if (!href) return null;
    if (href.startsWith("http")) return href;
    return `${this.cfg.baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
  }

  /**
   * Extract a stable record id from a Copper record URL/href. Delegates to the
   * centralized matcher, which understands Copper's `?fullProfile=people-<id>`
   * and `#/contact/<id>` forms.
   */
  protected idFromUrl(url: string | null): string | null {
    return routes.idFromHref(url);
  }
}
