/**
 * Map Copper's `contacts_api/<id>/activity_log_composite` JSON into the same
 * ActivitySummary shape the DOM feed reader produces — so a JSON-sourced read
 * flows through every downstream consumer (and the PACE mapper) unchanged.
 *
 * This is the FAST path: one authenticated GET returns a contact's full activity
 * history as structured JSON, versus one SPA navigation per contact. It is also
 * MORE complete (the DOM feed only renders a page of items) and MORE precise for
 * direction — Copper's own data says who the actor was.
 *
 * Activity-type ids and party semantics VERIFIED live 2026-07-28 on an
 * email-integrated account (Miniac, company 601304), sampling ~125 activities:
 *
 *   activity_type 6  → EMAIL   (template "{{target_sender}} to {{target_recipient}}")
 *                      actor.id null / company_user_id < 0  ⇒ external sender ⇒ INBOUND
 *                      actor.id = a company_user            ⇒ we sent it     ⇒ OUTBOUND
 *   activity_type 35 → MEETING (calendar; requester not recorded)
 *   activity_type 8  → system "added this record" (audit noise; skipped)
 *
 * The mapping is PURE, so every rule above is unit-tested.
 */
import type { ActivitySummary } from "../types/records.js";

export const COMPOSITE_PARSER_VERSION = "composite-1.0.0";

/** Copper system activity-type ids (see file header). */
const TYPE_EMAIL = 6;
const TYPE_MEETING = 35;
const TYPE_SYSTEM_ADD = 8;

/** The subset of composite fields we rely on. Everything else is ignored. */
export interface CompositeActivityItem {
  activity_type?: number | null;
  custom_activity_type_id?: number | null;
  actor?: { id?: number | null; entity_type?: number | null } | null;
  source_id?: number | null;
  target_id?: number | null;
  company_user_id?: number | null;
  text?: string | null;
  timestamp?: number | null;
  created_timestamp?: number | null;
  template_string?: string | null;
}

/** Epoch SECONDS (Copper) — or ms — to an ISO-8601 UTC instant. */
function toIso(ts: number | null | undefined): string | null {
  if (ts == null || !Number.isFinite(ts)) return null;
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Pull the activity array out of whatever envelope the endpoint returns. */
export function extractCompositeItems(json: unknown): CompositeActivityItem[] {
  if (Array.isArray(json)) return json as CompositeActivityItem[];
  const o = (json ?? {}) as Record<string, unknown>;
  for (const k of ["activity_logs", "activities", "logs", "documents", "data", "entries"]) {
    if (Array.isArray(o[k])) return o[k] as CompositeActivityItem[];
  }
  return [];
}

export function mapCompositeItem(it: CompositeActivityItem): ActivitySummary {
  const occurredAtIso = toIso(it.timestamp ?? it.created_timestamp);
  const base = {
    id: null,
    date: occurredAtIso,
    author: null,
    occurredAtIso,
    occurredAtRaw: null,
    details: it.text ?? null,
    inferred: false,
  };

  // System audit entry ("You added this Person") — not buyer signal.
  if (it.activity_type === TYPE_SYSTEM_ADD) {
    return {
      ...base,
      type: "record_created",
      actorKind: "system",
      channel: null,
      direction: "unknown",
      directionSource: "unknown",
      directionConfidence: 0,
      directionEvidence: null,
    };
  }

  // Auto-logged email — direction MEASURED from Copper's own data.
  if (it.activity_type === TYPE_EMAIL) {
    const internal = it.actor?.id != null && (it.company_user_id ?? 0) > 0;
    return {
      ...base,
      type: "email",
      channel: "email",
      actorKind: internal ? "self" : "other",
      direction: internal ? "outbound" : "inbound",
      directionSource: "measured_email",
      directionConfidence: 0.95,
      directionEvidence: internal
        ? "auto-logged email sent by an internal user"
        : "auto-logged email from an external sender",
    };
  }

  // Calendar meeting — who requested it is not recorded, so credit it
  // conservatively as a seller-initiated (attended) meeting rather than guess
  // the higher inbound tier.
  if (it.activity_type === TYPE_MEETING) {
    return {
      ...base,
      type: "meeting",
      channel: "in_person",
      actorKind: "self",
      direction: "outbound",
      directionSource: "measured_type",
      directionConfidence: 0.7,
      directionEvidence: "calendar meeting (requester not recorded — credited conservatively)",
    };
  }

  // Unrecognised type — keep it but leave direction unknown, so it is COUNTED as
  // unattributed rather than silently dropped or mis-scored.
  return {
    ...base,
    type: null,
    actorKind: "unknown",
    channel: null,
    direction: "unknown",
    directionSource: "unknown",
    directionConfidence: 0,
    directionEvidence: null,
  };
}

export function mapCompositeItems(items: CompositeActivityItem[]): ActivitySummary[] {
  return items.map(mapCompositeItem);
}
