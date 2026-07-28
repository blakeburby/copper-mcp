/**
 * Network-level write guard.
 *
 * The DOM lock (read-only mode: write tools unregistered, page-object methods
 * throw) stops the paths WE know about. This is the backstop for the paths we
 * don't: it sits on the network and can physically ABORT any mutating HTTP
 * request to Copper before it reaches the server. On an account where the login
 * itself has full write rights — because it's the client's own login and a
 * read-only Copper user isn't an option — this is what makes "read-only" a
 * guarantee rather than a hope.
 *
 * Two modes:
 *   - "audit"  — log every mutating request but let it through. Used to learn
 *                which verbs Copper's READ path actually uses, so blocking
 *                cannot silently break reads.
 *   - "block"  — abort mutating requests to Copper. The production default in
 *                read-only mode.
 *
 * Classifying "a write" is subtler than it looks, because — VERIFIED live
 * 2026-07-24 by auditing a read-only sync — Copper's READ path uses POST:
 *
 *   POST /api/v1/companies/{id}/contacts_api/search     (reading contacts)
 *   POST /api/v1/companies/{id}/tasks_api/search        (reading tasks)
 *   POST /api/v1/companies/{id}/reports_api/...          (reading activity)
 *
 * A blanket "block all POST" would break every read, and reads never use
 * PUT/PATCH/DELETE. So the classifier is:
 *
 *   GET / HEAD                          → always allow (reads)
 *   PUT / PATCH / DELETE to Copper      → BLOCK (reads never use these)
 *   POST to a KNOWN Copper read op      → allow  (see isKnownReadPost — an
 *                                          allowlist of query shapes, NOT a
 *                                          blanket `_api/` match)
 *   POST to any OTHER Copper path       → BLOCK (fail safe: a probable write)
 *
 * The bias is deliberately toward blocking the unknown. On an account managing
 * real revenue, a blocked read surfaces loudly as a fetch failure; an allowed
 * write is silent and irreversible.
 */
import type { BrowserContext, Route, Request } from "playwright";
import type { Logger } from "../utils/logger.js";

export type WriteGuardMode = "off" | "audit" | "block";

/** Reads never use these, so on a Copper host they are unambiguously writes. */
const ALWAYS_WRITE = new Set(["PUT", "PATCH", "DELETE"]);

/**
 * Whether a POST path is one of Copper's KNOWN READ operations.
 *
 * This is an ALLOWLIST, not a guess. The earlier version allowed any path
 * containing `_api/`, on the untested assumption that "writes use plain resource
 * paths". That assumption was never measured — only reads were ever observed —
 * and Copper namespaces its whole API under `_api/`, so a write posting to e.g.
 * `.../activities_api/create` would have been waved straight through. That hole
 * is the reason this function was rewritten.
 *
 * The families below are the reads VERIFIED 2026-07-27 during a full read-only
 * sync (list_people → get_person → get_person_activities across contacts):
 *   POST …/contacts_api/search        …/tasks_api/search
 *   POST …/agenda_items_api/search    …/contact_suggestions_api/search
 *   POST …/reports_api/activity_by_user
 *   POST …/analytics/track
 * plus common query verbs, so an unobserved READ is tolerated — but anything
 * that is not recognisably a query (every CRUD write) is blocked. The bias is
 * toward blocking the unknown: a wrongly-blocked read fails loudly; a wrongly-
 * allowed write is silent and irreversible. The full-sync-in-block regression
 * test confirms this allowlist does not starve a real sync of any read.
 */
function isKnownReadPost(path: string): boolean {
  const p = path.toLowerCase();
  // Observed read families.
  if (/\/search(\/|$)/.test(p)) return true; // *_api/search (contacts/tasks/agenda/suggestions)
  if (/\/reports?_api\//.test(p)) return true; // reports_api/activity_by_user
  if (/\/analytics(\/|$)/.test(p) || /\/track(\/|$)/.test(p)) return true;
  // General query verbs — read shapes that don't mutate. Deliberately excludes
  // create/update/delete/save and bare-resource POSTs, which are writes.
  if (/\/(list|index|lookup|autocomplete|suggestions?|count|filter|show|batch_get)(\/|$)/.test(p)) {
    return true;
  }
  return false;
}

/** Hosts we consider "Copper" — mutations here touch CRM data. */
function isCopperHost(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return /(^|\.)copper\.com$/i.test(h);
  } catch {
    return false;
  }
}

/**
 * How a request is classified. This is the SINGLE source of truth for both the
 * live guard and the onboarding discovery tool — so the discovery report
 * predicts exactly what block-mode would do to the client's real traffic.
 */
export type RequestClass =
  | "non-copper" // any host that is not Copper — never our concern
  | "copper-read-get" // GET/HEAD to Copper — a read, always allowed
  | "copper-read-post" // POST to a known Copper read op — allowed
  | "copper-mutation"; // PUT/PATCH/DELETE, or POST to a non-read Copper path — BLOCKED in block mode

export function classifyCopperRequest(method: string, url: string): RequestClass {
  const m = method.toUpperCase();
  if (!isCopperHost(url)) return "non-copper";
  if (m === "GET" || m === "HEAD") return "copper-read-get";
  if (m === "POST" && isKnownReadPost(safePath(url))) return "copper-read-post";
  return "copper-mutation";
}

export interface WriteGuardStats {
  mutatingSeen: number;
  mutatingBlocked: number;
  /** Distinct "METHOD path" seen, for the audit report. */
  samples: string[];
}

/**
 * Install the guard on a context. Returns a stats object that accumulates as
 * requests flow, so a sync can prove afterwards how many writes were attempted
 * (and, in block mode, stopped).
 */
export async function installWriteGuard(
  context: BrowserContext,
  mode: WriteGuardMode,
  log: Logger,
): Promise<WriteGuardStats> {
  const stats: WriteGuardStats = { mutatingSeen: 0, mutatingBlocked: 0, samples: [] };
  if (mode === "off") return stats;

  await context.route("**/*", async (route: Route, request: Request) => {
    const method = request.method().toUpperCase();

    // One classifier, shared with the discovery tool. Anything that is not a
    // Copper mutation is allowed and not counted (reads, non-Copper traffic).
    if (classifyCopperRequest(method, request.url()) !== "copper-mutation") {
      return route.continue();
    }

    const path = safePath(request.url());

    // Everything left is a probable write: PUT/PATCH/DELETE, or a POST to a
    // non-read Copper path.
    stats.mutatingSeen += 1;
    const sample = `${method} ${path}`;
    if (stats.samples.length < 50 && !stats.samples.includes(sample)) {
      stats.samples.push(sample);
    }

    if (mode === "block") {
      stats.mutatingBlocked += 1;
      log.warn("WRITE GUARD blocked a probable WRITE to Copper", {
        method,
        path,
        reason: ALWAYS_WRITE.has(method) ? "mutating verb" : "POST to non-read path",
      });
      return route.abort("blockedbyclient");
    }

    // audit
    log.warn("WRITE GUARD (audit) saw a probable write to Copper — allowed", { method, path });
    return route.continue();
  });

  log.info(`Write guard installed in "${mode}" mode.`);
  return stats;
}

function safePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname; // never the query string — it can carry data
  } catch {
    return "(unparseable)";
  }
}
