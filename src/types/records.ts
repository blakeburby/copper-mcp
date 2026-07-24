/**
 * Structured record shapes returned by the tools. Fields are optional because
 * the web UI does not always expose every field, and different Copper accounts
 * configure different columns. Tools return whatever they can reliably extract.
 */

export type ParentType = "person" | "company" | "opportunity" | "lead";

export interface PersonSummary {
  /** Copper record id (stable numeric id from the record URL when available). */
  id: string | null;
  name: string | null;
  title: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  owner: string | null;
  tags: string[];
  /** Absolute URL to the record in the Copper web app. */
  recordUrl: string | null;
}

export interface PersonDetail extends PersonSummary {
  emails: string[];
  phones: string[];
  /** Recent activities visible on the record, newest first. */
  activities: ActivitySummary[];
}

export interface CompanySummary {
  id: string | null;
  name: string | null;
  emailDomain: string | null;
  phone: string | null;
  owner: string | null;
  tags: string[];
  recordUrl: string | null;
}

export interface OpportunitySummary {
  id: string | null;
  name: string | null;
  companyName: string | null;
  pipeline: string | null;
  stage: string | null;
  status: string | null;
  owner: string | null;
  value: string | null;
  closeDate: string | null;
  recordUrl: string | null;
}

export interface OpportunityDetail extends OpportunitySummary {
  primaryContact: string | null;
  tags: string[];
  activities: ActivitySummary[];
}

export interface PipelineSummary {
  id: string | null;
  name: string | null;
  stages: string[];
}

export interface ActivitySummary {
  id: string | null;
  type: string | null;
  details: string | null;
  date: string | null;
  author: string | null;

  // --- Enrichment added 2026-07-24 after verifying the live feed -------------
  // All optional so existing callers (get_person, get_opportunity) keep working.

  /** ISO-8601 UTC instant parsed from <time datetime>. The authoritative time. */
  occurredAtIso?: string | null;
  /** The rendered time text ("2:30 PM") — display only, never parse this. */
  occurredAtRaw?: string | null;
  /** Actor relative to the signed-in user. */
  actorKind?: "self" | "other" | "system" | "unknown";
  /** Communication channel implied by the activity type. */
  channel?: string | null;
  /** Who initiated: inbound = buyer, outbound = your outreach. */
  direction?: "inbound" | "outbound" | "unknown";
  /** Provenance of `direction` — measured beats inferred. */
  directionSource?: "measured_email" | "measured_type" | "inferred_text" | "unknown";
  /** 0..1 confidence in the direction call. */
  directionConfidence?: number;
  /** Which rule produced `direction`, so a downstream score stays auditable. */
  directionEvidence?: string | null;
  /** True when type/channel came from phrasing rather than an explicit field. */
  inferred?: boolean;
}

/**
 * Whether the feed was genuinely read.
 *
 * This exists to make one specific failure impossible: an empty array that
 * actually means "the selector broke". A scoring system consuming that would
 * mark every contact cold. `confirmedEmpty` requires a POSITIVE empty-state
 * signal; a missing container throws SELECTOR_FAILURE instead of returning [].
 */
export type FeedState = "populated" | "confirmed_empty";

export interface ActivityFeedResult {
  activities: ActivitySummary[];
  feedState: FeedState;
  /** Items the container yielded, before parsing. */
  itemsSeen: number;
  /** Items from which a usable timestamp was extracted. */
  itemsParsed: number;
  /** Non-fatal parse concerns worth surfacing (e.g. a low parse rate). */
  parseWarnings: string[];
  /** Bumped whenever the parser changes, so stored events stay traceable. */
  parserVersion: string;
}

export interface TaskSummary {
  id: string | null;
  title: string | null;
  dueDate: string | null;
  status: string | null;
  relatedTo: string | null;
  recordUrl: string | null;
}

/** Preview returned by a write tool when confirm is not yet true. */
export interface WritePreview {
  action: string;
  willSubmit: false;
  summary: Record<string, unknown>;
  note: string;
}
