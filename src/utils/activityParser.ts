/**
 * Pure parsing helpers for Copper activity-feed items.
 *
 * Kept free of Playwright so the classification rules can be unit-tested against
 * plain strings. The page object does the DOM reads and hands the raw pieces in.
 *
 * Grounded in live DOM captured 2026-07-24, e.g.
 *   header:   "You logged a Phone Call"
 *   actor:    "You"
 *   datetime: "2026-07-24T21:30:39.000Z"
 */

/** Communication channel an activity came through, when determinable. */
export type ActivityChannel = "email" | "phone" | "linkedin" | "in_person" | "referral" | "other";

/** Who performed the activity, relative to the signed-in user. */
export type ActivityActorKind = "self" | "other" | "system" | "unknown";

export interface ParsedActivityMeta {
  /** Normalized activity type, e.g. "phone_call", "note", "meeting". */
  type: string | null;
  /** Channel implied by the type, when one can be determined. */
  channel: ActivityChannel | null;
  /** Whether the actor is the signed-in user, another person, or the system. */
  actorKind: ActivityActorKind;
  /** True when type/channel came from phrasing rather than an explicit field. */
  inferred: boolean;
  /** 0..1 confidence in the type/channel classification. */
  confidence: number;
}

/**
 * Parse the `datetime` attribute of an activity's <time> element.
 * Returns an ISO-8601 string, or null when absent/unparseable.
 *
 * Always prefer this over the visible "2:30 PM" text, which is locale- and
 * timezone-dependent and omits the date entirely.
 */
export function parseActivityTimestamp(datetimeAttr: string | null | undefined): string | null {
  if (!datetimeAttr) return null;
  const ms = Date.parse(datetimeAttr);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Classify an activity from its header phrasing.
 *
 * Copper renders headers like "You logged a Phone Call", "You added this Person",
 * "You assigned this to You". The leading actor is a link; the remainder carries
 * the type. Everything here is phrasing-derived, hence `inferred: true` for
 * anything but an exact known form.
 */
export function classifyActivityHeader(
  header: string | null | undefined,
  actorText: string | null | undefined,
): ParsedActivityMeta {
  const text = (header ?? "").trim();
  const actor = (actorText ?? "").trim();

  const actorKind: ActivityActorKind = !actor
    ? "unknown"
    : /^you$/i.test(actor)
      ? "self"
      : "other";

  if (!text) {
    return { type: null, channel: null, actorKind, inferred: false, confidence: 0 };
  }

  // Ordered most-specific first; the first match wins.
  const rules: Array<{
    re: RegExp;
    type: string;
    channel: ActivityChannel | null;
    confidence: number;
    system?: boolean;
  }> = [
    { re: /logged a phone call|phone call/i, type: "phone_call", channel: "phone", confidence: 0.95 },
    { re: /logged a meeting|meeting/i, type: "meeting", channel: "in_person", confidence: 0.85 },
    { re: /sent an email|logged an email|email/i, type: "email", channel: "email", confidence: 0.9 },
    { re: /linkedin/i, type: "linkedin_message", channel: "linkedin", confidence: 0.9 },
    { re: /sms|text message/i, type: "sms", channel: "phone", confidence: 0.9 },
    { re: /logged a note|created a note|\bnote\b/i, type: "note", channel: null, confidence: 0.8 },
    // System/audit entries — real events, but not buyer signal.
    { re: /assigned this to/i, type: "assignment", channel: null, confidence: 0.95, system: true },
    { re: /added this (person|company|opportunity|lead)/i, type: "record_created", channel: null, confidence: 0.95, system: true },
    { re: /changed|updated|edited/i, type: "field_change", channel: null, confidence: 0.7, system: true },
  ];

  for (const rule of rules) {
    if (rule.re.test(text)) {
      return {
        type: rule.type,
        channel: rule.channel,
        actorKind: rule.system ? "system" : actorKind,
        inferred: true,
        confidence: rule.confidence,
      };
    }
  }

  return { type: "unknown", channel: null, actorKind, inferred: true, confidence: 0.2 };
}

/**
 * Strip the actor prefix off a header to leave the action phrase.
 * "You logged a Phone Call" + actor "You" -> "logged a Phone Call"
 */
export function actionPhrase(
  header: string | null | undefined,
  actorText: string | null | undefined,
): string | null {
  const text = (header ?? "").trim();
  if (!text) return null;
  const actor = (actorText ?? "").trim();
  if (actor && text.toLowerCase().startsWith(actor.toLowerCase())) {
    return text.slice(actor.length).trim() || null;
  }
  return text;
}
