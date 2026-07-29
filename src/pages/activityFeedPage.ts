/**
 * Activity feed reader.
 *
 * ── THE CONTRACT THIS FILE EXISTS TO ENFORCE ────────────────────────────────
 * `peoplePage.activities()` uses `tryResolve` and returns `[]` when the feed
 * selector misses. That makes a broken selector indistinguishable from "this
 * contact has no activity" — and a warmth score consuming it would mark every
 * contact Cold. A scoring system that silently reports everyone cold because a
 * class name changed is worse than no scoring system.
 *
 * So this reader resolves the feed CONTAINER with `resolve()`, which throws.
 * There are exactly three outcomes:
 *
 *   container found + items       -> feedState "populated"
 *   container found + 0 items     -> feedState "confirmed_empty"
 *   container missing             -> throws SELECTOR_FAILURE (never [])
 *
 * There is no code path that yields an empty result without having positively
 * confirmed the container rendered.
 *
 * Anatomy VERIFIED live 2026-07-24 — see `activityFeed` in copperSelectors.ts.
 */
import type { Locator } from "playwright";
import { BasePage } from "./basePage.js";
import { activityFeed, routes, type EntityKind } from "../selectors/copperSelectors.js";
import {
  parseActivityTimestamp,
  classifyActivityHeader,
  actionPhrase,
} from "../utils/activityParser.js";
import { resolveDirection, emailDirectionFromParties } from "../utils/activityDirection.js";
import {
  mapCompositeItems,
  extractCompositeItems,
  COMPOSITE_PARSER_VERSION,
} from "../utils/compositeActivity.js";
import type { ActivitySummary, ActivityFeedResult } from "../types/records.js";
import { CopperToolError } from "../types/errors.js";
import { captureDiagnostics } from "../browser/diagnostics.js";

/** Bump when extraction changes, so stored events remain traceable. */
export const PARSER_VERSION = "1.0.0";

/** Below this share of items yielding a timestamp, the read is suspect. */
const MIN_PARSE_RATE = 0.5;
/** Between this and MIN_PARSE_RATE we succeed but warn. */
const WARN_PARSE_RATE = 0.8;

export interface ReadFeedOptions {
  limit?: number;
  /** Only return items at or after this ISO instant. */
  sinceIso?: string;
}

export class ActivityFeedPage extends BasePage {
  /**
   * Read a record's activity feed. Throws SELECTOR_FAILURE rather than
   * returning an ambiguous empty list.
   */
  async readFeed(
    kind: EntityKind,
    recordId: string,
    opts: ReadFeedOptions = {},
  ): Promise<ActivityFeedResult> {
    const limit = opts.limit ?? 50;

    await this.gotoAppRoute(routes.recordView(kind, encodeURIComponent(recordId)));
    await this.waitForSettled();
    // networkidle is not enough on this SPA — wait for the spinner to clear.
    await this.waitForAppReady();

    // resolve() (not tryResolve) — a missing container must throw.
    let container: Locator;
    try {
      container = await this.resolve(activityFeed.list, { state: "attached" });
    } catch (err) {
      const diag = await captureDiagnostics(this.raw, "activity_feed_container", {
        includeHtml: true,
        logger: this.log,
        consoleMessages: this.consoleMessages,
      });
      const e =
        err instanceof CopperToolError
          ? err
          : new CopperToolError("SELECTOR_FAILURE", "Could not locate the activity feed.");
      e.artifactPath = diag.screenshotPath;
      throw e;
    }

    const items = activityFeed.item.primary(container);
    const itemsSeen = await items.count().catch(() => 0);

    if (itemsSeen === 0) {
      // The container rendered and is genuinely empty. This is the ONLY path to
      // an empty result, and it required the container to be present.
      this.log.info("Activity feed rendered with zero items (confirmed empty).");
      return {
        activities: [],
        feedState: "confirmed_empty",
        itemsSeen: 0,
        itemsParsed: 0,
        parseWarnings: [],
        parserVersion: PARSER_VERSION,
      };
    }

    const activities: ActivitySummary[] = [];
    let itemsParsed = 0;
    const sinceMs = opts.sinceIso ? Date.parse(opts.sinceIso) : null;

    for (let i = 0; i < itemsSeen && activities.length < limit; i++) {
      const item = items.nth(i);
      const parsed = await this.parseItem(item, recordId);
      if (parsed.occurredAtIso) itemsParsed++;

      if (sinceMs !== null && parsed.occurredAtIso) {
        // Feed is newest-first; once we pass the cursor everything else is older.
        if (Date.parse(parsed.occurredAtIso) < sinceMs) break;
      }
      activities.push(parsed);
    }

    const parseRate = itemsSeen > 0 ? itemsParsed / itemsSeen : 1;
    const parseWarnings: string[] = [];

    if (parseRate < MIN_PARSE_RATE) {
      // The container still matches but the item internals moved. Left
      // unchecked this yields items with null timestamps, and every contact
      // scores Cold — the same hazard, one level down.
      const diag = await captureDiagnostics(this.raw, "activity_feed_parse_rate", {
        includeHtml: true,
        logger: this.log,
      });
      const e = new CopperToolError(
        "AMBIGUOUS_RESULT",
        `Only ${itemsParsed} of ${itemsSeen} activity items yielded a timestamp.`,
        "The feed container still matches but item internals appear to have changed. Treat these results as unreliable and re-verify the selectors.",
      );
      e.artifactPath = diag.screenshotPath;
      throw e;
    }
    if (parseRate < WARN_PARSE_RATE) {
      parseWarnings.push(
        `Low parse rate: ${itemsParsed}/${itemsSeen} items yielded a timestamp.`,
      );
    }

    return {
      activities,
      feedState: "populated",
      itemsSeen,
      itemsParsed,
      parseWarnings,
      parserVersion: PARSER_VERSION,
    };
  }

  /**
   * FAST path — read a contact's activity from Copper's own JSON endpoint
   * (`contacts_api/<id>/activity_log_composite`) via an authenticated in-page
   * fetch, instead of navigating the SPA. One request returns the full history
   * with structured parties, so direction is measured, not inferred.
   *
   * The page must already be on the authenticated app shell (the account id is
   * read from the URL). A non-200 or non-JSON response THROWS SELECTOR_FAILURE —
   * a failed fetch is never laundered into "confirmed_empty"; the caller falls
   * back to the DOM reader.
   */
  async readFeedComposite(
    contactId: string,
    opts: ReadFeedOptions = {},
  ): Promise<ActivityFeedResult> {
    const limit = opts.limit ?? 100;
    const url = this.raw.url();
    const accountId = url.match(/\/companies\/(\d+)\//)?.[1];
    if (!accountId) {
      throw new CopperToolError(
        "SELECTOR_FAILURE",
        "Not on the Copper app shell (no account id in URL); cannot use the JSON reader.",
      );
    }
    const origin = new URL(url).origin;
    const path =
      `/api/v1/companies/${accountId}/contacts_api/${encodeURIComponent(contactId)}` +
      `/activity_log_composite?system_activity_type_ids[]=-1&system_activity_type_ids[]=-2` +
      `&limit=${Math.min(Math.max(limit, 1), 500)}`;

    const res = await this.raw.evaluate(async (u: string) => {
      try {
        const r = await fetch(u, { credentials: "include", headers: { accept: "application/json" } });
        return { status: r.status, body: await r.text() };
      } catch (e) {
        return { status: 0, body: e instanceof Error ? e.message : String(e) };
      }
    }, `${origin}${path}`);

    if (res.status !== 200) {
      throw new CopperToolError(
        "SELECTOR_FAILURE",
        `activity_log_composite returned HTTP ${res.status}.`,
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(res.body);
    } catch {
      throw new CopperToolError("SELECTOR_FAILURE", "activity_log_composite response was not JSON.");
    }

    const items = extractCompositeItems(json);
    const mapped = mapCompositeItems(items);

    const sinceMs = opts.sinceIso ? Date.parse(opts.sinceIso) : null;
    const activities: ActivitySummary[] = [];
    for (const a of mapped) {
      if (activities.length >= limit) break;
      // Composite is newest-first; once we pass the cursor, stop.
      if (sinceMs !== null && a.occurredAtIso && Date.parse(a.occurredAtIso) < sinceMs) break;
      activities.push(a);
    }

    const itemsParsed = activities.filter((a) => a.occurredAtIso).length;
    return {
      activities,
      feedState: items.length === 0 ? "confirmed_empty" : "populated",
      itemsSeen: items.length,
      itemsParsed,
      parseWarnings: [],
      parserVersion: COMPOSITE_PARSER_VERSION,
    };
  }

  /** Extract one feed item. DOM reads here, classification in the pure modules. */
  private async parseItem(item: Locator, recordId: string): Promise<ActivitySummary> {
    const header = await this.textOf(activityFeed.header.primary(item)).catch(() => null);
    const actor = await this.textOf(activityFeed.actorLink.primary(item)).catch(() => null);

    const timeEl = activityFeed.timestamp.primary(item);
    const datetimeAttr = await this.attrOf(timeEl, "datetime").catch(() => null);
    const occurredAtRaw = await this.textOf(timeEl).catch(() => null);

    const body = await this.textOf(activityFeed.body.primary(item)).catch(() => null);

    // Auto-logged email (correspondence): read the sender/recipient pills in one
    // page call so direction is MEASURED from the parties, not inferred from text.
    const email = await this.readEmailParties(item);

    const meta = classifyActivityHeader(header, actor);
    // A correspondence item is unambiguously an email even when the header lacks
    // the "logged an Email" phrasing the classifier keys on.
    const type = email.isEmail ? "email" : meta.type;
    const channel = email.isEmail ? "email" : meta.channel;

    const emailDir = email.isEmail
      ? emailDirectionFromParties({
          contactId: recordId,
          senderHref: email.senderHref,
          recipientHref: email.recipientHref,
        })
      : null;

    const direction = resolveDirection({
      type,
      header,
      body,
      actor,
      autoLogged: email.isEmail,
      emailDirection: emailDir?.direction ?? null,
      emailEvidence: emailDir?.evidence ?? null,
    });

    return {
      id: null,
      type,
      details: actionPhrase(header, actor) ?? body,
      date: parseActivityTimestamp(datetimeAttr),
      author: actor,
      occurredAtIso: parseActivityTimestamp(datetimeAttr),
      occurredAtRaw,
      actorKind: meta.actorKind,
      channel,
      direction: direction.direction,
      directionSource: direction.source,
      directionConfidence: direction.confidence,
      directionEvidence: direction.evidence,
      inferred: meta.inferred,
    };
  }

  /**
   * Read the correspondence sender/recipient hrefs for one item in a single page
   * evaluation. Mirrors the `activityFeed.emailHeader/senderPill/recipientPill`
   * selectors; a CRM contact's pill links to `/#/contact/<id>`, an internal
   * user's does not — which is what lets emailDirectionFromParties decide.
   */
  private async readEmailParties(
    item: Locator,
  ): Promise<{ isEmail: boolean; senderHref: string | null; recipientHref: string | null }> {
    return item
      .evaluate((el: Element) => {
        const isEmail =
          !!el.querySelector("[class*='emailHeader']") ||
          (el.getAttribute("class") || "").includes("ActivityItem-correspondence");
        if (!isEmail) return { isEmail: false, senderHref: null, recipientHref: null };
        const hrefOf = (sel: string): string | null => {
          const p = el.querySelector(sel);
          if (!p) return null;
          const a = p.matches("a") ? p : p.querySelector("a");
          return (a && a.getAttribute("href")) || p.getAttribute("href") || null;
        };
        return {
          isEmail: true,
          senderHref: hrefOf(".ActivityItem_senderPill"),
          recipientHref: hrefOf(".ActivityItem_firstRecipientPill"),
        };
      })
      .catch(() => ({ isEmail: false, senderHref: null, recipientHref: null }));
  }
}
