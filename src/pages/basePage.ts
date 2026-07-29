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
import { getBrowserManager } from "../browser/browserManager.js";
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

/**
 * How safeFill verifies the element it is about to type into: by its
 * placeholder (Copper's stable handle for inputs) or, for placeholder-less
 * targets like the Froala contenteditable, by another attribute.
 */
export type FillTarget =
  | { placeholder: RegExp }
  | { attribute: { name: string; pattern: RegExp } };

/**
 * Page-scoped console ring buffers + a "listeners installed" guard.
 *
 * A BasePage is constructed once PER TOOL CALL, but the persistent context
 * reuses ONE long-lived page across the whole session. Attaching the
 * console/pageerror/requestfailed/dialog listeners in the constructor therefore
 * leaked a fresh set of listeners on every call — thousands over a bulk sync,
 * an unbounded growth vector on the exact long runs this is meant to survive.
 * Keying by Page installs them EXACTLY ONCE per page; every BasePage wrapping
 * that page shares the same buffer.
 */
const pageConsoleBuffers = new WeakMap<Page, string[]>();
const pageListenersInstalled = new WeakSet<Page>();
const MAX_CONSOLE = 300;

export class BasePage {
  protected readonly cfg = loadConfig();

  constructor(
    protected readonly page: Page,
    protected readonly log: Logger = createLogger(),
  ) {
    if (pageListenersInstalled.has(page)) return;
    pageListenersInstalled.add(page);

    const buffer: string[] = [];
    pageConsoleBuffers.set(page, buffer);
    const record = (line: string) => {
      buffer.push(`${new Date().toISOString()} ${line}`);
      if (buffer.length > MAX_CONSOLE) buffer.shift();
    };
    page.on("console", (m) => record(`[console.${m.type()}] ${m.text()}`));
    page.on("pageerror", (e) => record(`[pageerror] ${e.message}`));
    page.on("requestfailed", (r) =>
      record(`[requestfailed] ${r.method()} ${r.url()} — ${r.failure()?.errorText ?? "?"}`),
    );

    // Auto-dismiss unexpected native dialogs so they can't wedge automation.
    page.on("dialog", (dialog: Dialog) => {
      this.log.warn("Auto-dismissing native dialog", {
        type: dialog.type(),
        message: dialog.message(),
      });
      void dialog.dismiss().catch(() => undefined);
    });
  }

  /** This page's console/error ring buffer (page-scoped, shared across calls). */
  private get consoleBuffer(): string[] {
    return pageConsoleBuffers.get(this.page) ?? [];
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
    // Count this record navigation toward the page-recycle threshold.
    getBrowserManager().noteNavigation();
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
   * Copper's record-detail fields are inline-editable <input>s whose
   * placeholders follow the "Add <Field>" convention ("Add Name", "Add Email" —
   * verified live 2026-07-24). Typing into one of those SAVES data on the
   * record. This signature is the negative gate in safeFill.
   */
  private static readonly RECORD_FIELD_PLACEHOLDER = /^add\s/i;

  /**
   * Fill a locator ONLY after verifying, at the moment of typing, that the
   * resolved element is the field we think it is.
   *
   * Why this exists: this server may run on a login with full write rights over
   * a production CRM (a read-only Copper user is not always available). Selector
   * drift — especially through the looser fallback selectors — could resolve a
   * "search box" to an inline-editable record field, and fill() would then
   * silently overwrite real data. "The selector is probably right" is not an
   * acceptable standard on that account; "the target is verified safe right
   * now" is. On mismatch this throws SELECTOR_FAILURE and captures diagnostics
   * rather than typing.
   */
  async safeFill(
    locator: Locator,
    target: FillTarget,
    value: string,
    label: string,
  ): Promise<void> {
    const el = locator.first();
    const placeholder = await this.attrOf(el, "placeholder");

    let verified: boolean;
    let expectation: string;
    let recordFieldGateApplies: boolean;

    if ("placeholder" in target) {
      verified = placeholder !== null && target.placeholder.test(placeholder);
      expectation = `placeholder ${target.placeholder}`;
      // If the caller EXPECTS an "Add *" field (e.g. the task composer's own
      // "Add Name"), the negative gate below would always fire — skip it, the
      // positive match already pins the exact field.
      recordFieldGateApplies = !BasePage.RECORD_FIELD_PLACEHOLDER.test(
        target.placeholder.source.replace(/^\^/, "").replace(/\\s/g, " "),
      );
    } else {
      const attrValue = await this.attrOf(el, target.attribute.name);
      verified = attrValue !== null && target.attribute.pattern.test(attrValue);
      expectation = `attribute ${target.attribute.name}~${target.attribute.pattern}`;
      recordFieldGateApplies = true;
    }

    const isRecordField =
      recordFieldGateApplies &&
      placeholder !== null &&
      BasePage.RECORD_FIELD_PLACEHOLDER.test(placeholder);

    if (!verified || isRecordField) {
      const diag = await captureDiagnostics(this.page, `safefill_refused_${label}`, {
        includeHtml: true,
        logger: this.log,
        consoleMessages: this.consoleMessages,
      });
      // The record-field reason goes in the MESSAGE, not just details: "typing
      // here would modify CRM data" is exactly the thing that must be visible at
      // the top level of any log or error surface, never buried.
      const reason = isRecordField
        ? `it matches Copper's inline-editable record-field signature (placeholder ${JSON.stringify(placeholder)}) — typing here would modify CRM data`
        : `the resolved element (placeholder ${JSON.stringify(placeholder)}) does not verify as "${label}" (expected ${expectation})`;
      const e = new CopperToolError(
        "SELECTOR_FAILURE",
        `Refusing to type into "${label}": ${reason}. The selector has likely drifted; nothing was typed.`,
        "Target-verified fill (safeFill) refused the element it resolved. Re-verify the selector against the live Copper UI.",
      );
      e.artifactPath = diag.screenshotPath;
      throw e;
    }

    await el.click();
    await el.fill(value);
  }

  /**
   * Type a query into the global search box and submit.
   *
   * The fill is target-verified (see safeFill): even if the search selector
   * drifts to some other input, nothing is typed unless the element carries the
   * verified global-search placeholder.
   */
  async fillGlobalSearch(query: string): Promise<void> {
    const input = await this.resolve(globalSearch.input);
    await this.safeFill(
      input,
      { placeholder: /search by name.*email.*domain/i },
      query,
      "global search input",
    );
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

  /**
   * Enumerate ALL rows in a list view by SCROLLING, not just the first rendered
   * screen. Copper's list virtualizes rows, so a single DOM read
   * (collectRowLinks) only ever sees the first window — which silently truncates
   * a large roster to ~the first page. This is the difference between scoring a
   * 2-contact dev account and a real account with thousands.
   *
   * Rows are accumulated across scroll steps and deduped by their record href
   * (Copper's `?fullProfile=<plural>-<id>`, a stable id), so a virtualizer
   * unloading earlier rows never loses them. Termination is by STAGNATION: when
   * scrolling yields no new records for `stagnantLimit` consecutive rounds, the
   * end has been reached (`complete: true`). Hitting `cap` first means more may
   * exist (`complete: false`) — a truncation the caller MUST surface, never hide.
   *
   * Reads are batched: one `evaluateAll` per round extracts href+name for every
   * rendered row in a single page call, so cost is ~O(rounds × windowSize), not a
   * Playwright round-trip per row.
   *
   * NOTE: the exact pagination model (infinite-scroll vs windowed virtualization)
   * is confirmed by the live discovery pass; scrolling the last rendered row into
   * view is model-agnostic and handles both without a scroll-container selector.
   */
  async collectAllRowLinks(
    cap: number,
    opts: { stagnantLimit?: number; maxRounds?: number } = {},
  ): Promise<{ rows: Array<{ name: string | null; href: string | null }>; complete: boolean }> {
    const stagnantLimit = opts.stagnantLimit ?? 3;
    const maxRounds = opts.maxRounds ?? 3_000; // hard guard against an infinite loop

    let rows: Locator;
    try {
      rows = await this.resolve(list.rows, { timeout: 4_000 });
    } catch {
      // Distinguish a genuine empty roster from a broken selector. An empty state
      // IS a complete answer (zero rows, confirmed); a stale selector is NOT.
      const empty = await this.tryResolve(list.emptyState, { timeout: 1_500 });
      this.log.debug(
        empty ? "Enumeration: empty-state present — zero rows." : "Enumeration: row selector may be stale.",
      );
      return { rows: [], complete: !!empty };
    }

    const seen = new Map<string, { name: string | null; href: string | null }>();
    let stagnant = 0;

    for (let round = 0; round < maxRounds; round++) {
      const before = seen.size;
      // Batched extraction — mirrors the list.rowLink / list.rowName selectors,
      // read in one page call for the whole rendered window.
      const batch = await rows
        .evaluateAll((els) =>
          els.map((el) => {
            const a =
              el.querySelector("a.fullProfileLink") ??
              el.querySelector("a[href*='fullProfile='], a[href*='#/']");
            const href = a?.getAttribute("href") ?? null;
            const nameClean = el.querySelector(".AvatarPill_text")?.textContent ?? null;
            const nameRaw = a?.textContent ?? null;
            return { href, nameClean, nameRaw };
          }),
        )
        .catch(() => [] as Array<{ href: string | null; nameClean: string | null; nameRaw: string | null }>);

      for (const r of batch) {
        const name = (r.nameClean?.trim() || this.stripAvatarInitial(r.nameRaw)) ?? null;
        if (!r.href && !name) continue; // header row / non-record
        const key = r.href ?? `name:${name}`;
        if (!seen.has(key)) seen.set(key, { name, href: this.absolutize(r.href) });
      }

      if (seen.size >= cap) {
        this.log.warn(`Enumeration hit cap ${cap} — result is TRUNCATED (more records exist).`);
        return { rows: [...seen.values()].slice(0, cap), complete: false };
      }

      stagnant = seen.size === before ? stagnant + 1 : 0;
      if (stagnant >= stagnantLimit) {
        this.log.info(`Enumeration complete: ${seen.size} record(s), no new rows after scrolling.`);
        return { rows: [...seen.values()], complete: true };
      }

      // Scroll the last rendered row into view to force the next window to render.
      const total = await rows.count().catch(() => 0);
      if (total > 0) {
        await rows
          .nth(total - 1)
          .scrollIntoViewIfNeeded({ timeout: 3_000 })
          .catch(() => undefined);
      }
      await this.waitForRowChange(rows, total);
    }

    this.log.warn(`Enumeration hit maxRounds ${maxRounds} — returning ${seen.size} (TRUNCATED).`);
    return { rows: [...seen.values()], complete: false };
  }

  /**
   * After a scroll, wait briefly for the rendered row set to change so the next
   * round reads fresh rows — polling so we return the instant new rows appear
   * rather than burning a fixed sleep.
   */
  private async waitForRowChange(rows: Locator, prevCount: number): Promise<void> {
    const deadline = Date.now() + 1_500;
    while (Date.now() < deadline) {
      const c = await rows.count().catch(() => prevCount);
      if (c !== prevCount) return;
      await this.page.waitForTimeout(150);
    }
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
