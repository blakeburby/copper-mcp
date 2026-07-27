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
 * A blanket "block all POST" would break every read. But the reads sit in a
 * distinct `*_api/` namespace, and reads never use PUT/PATCH/DELETE. So the
 * classifier is:
 *
 *   GET / HEAD                      → always allow (reads)
 *   PUT / PATCH / DELETE to Copper  → BLOCK (reads never use these)
 *   POST to a Copper read endpoint  → allow  (the `*_api/`, /search, analytics)
 *   POST to any OTHER Copper path    → BLOCK (fail safe: a probable write)
 *
 * The bias is deliberately toward blocking the unknown. On an account managing
 * real revenue, a blocked read surfaces loudly as a fetch failure; an allowed
 * write is silent and irreversible.
 */
import type { BrowserContext, Route, Request } from "playwright";
import type { Logger } from "../utils/logger.js";

export type WriteGuardMode = "off" | "audit" | "block";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Reads never use these, so on a Copper host they are unambiguously writes. */
const ALWAYS_WRITE = new Set(["PUT", "PATCH", "DELETE"]);

/**
 * A POST path that Copper's READ path uses. VERIFIED: reads namespace under
 * `*_api/` and hit /search and /analytics; writes use plain resource paths.
 */
function isReadShapedPost(path: string): boolean {
  return (
    /_api\//i.test(path) ||
    /\/search(\/|$)/i.test(path) ||
    /\/analytics\//i.test(path) ||
    /\/track(\/|$)/i.test(path)
  );
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

    if (!MUTATING.has(method) || !isCopperHost(request.url())) {
      return route.continue();
    }

    const path = safePath(request.url());

    // A POST to a read-shaped Copper endpoint is a READ — never block it, and
    // don't count it as a mutation. (Copper reads via POST /…_api/search.)
    if (method === "POST" && isReadShapedPost(path)) {
      return route.continue();
    }

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
