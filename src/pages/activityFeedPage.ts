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
import { resolveDirection } from "../utils/activityDirection.js";
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
      const parsed = await this.parseItem(item);
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

  /** Extract one feed item. DOM reads here, classification in the pure modules. */
  private async parseItem(item: Locator): Promise<ActivitySummary> {
    const header = await this.textOf(activityFeed.header.primary(item)).catch(() => null);
    const actor = await this.textOf(activityFeed.actorLink.primary(item)).catch(() => null);

    const timeEl = activityFeed.timestamp.primary(item);
    const datetimeAttr = await this.attrOf(timeEl, "datetime").catch(() => null);
    const occurredAtRaw = await this.textOf(timeEl).catch(() => null);

    const body = await this.textOf(activityFeed.body.primary(item)).catch(() => null);

    const meta = classifyActivityHeader(header, actor);
    const direction = resolveDirection({
      type: meta.type,
      header,
      body,
      actor,
      // Auto-logged detection needs an integrated account to verify; until then
      // manual logs are the only case we see. See activityDirection.ts.
      autoLogged: false,
    });

    return {
      id: null,
      type: meta.type,
      details: actionPhrase(header, actor) ?? body,
      date: parseActivityTimestamp(datetimeAttr),
      author: actor,
      occurredAtIso: parseActivityTimestamp(datetimeAttr),
      occurredAtRaw,
      actorKind: meta.actorKind,
      channel: meta.channel,
      direction: direction.direction,
      directionSource: direction.source,
      directionConfidence: direction.confidence,
      directionEvidence: direction.evidence,
      inferred: meta.inferred,
    };
  }
}
