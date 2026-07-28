/**
 * Pure helpers for the onboarding discovery tool.
 *
 * Kept separate from the tool (which drives a browser) so the grouping and
 * verdict logic — the part that decides what an operator must widen before
 * block-mode — is unit-testable without Playwright.
 */
import { classifyCopperRequest, type RequestClass } from "./writeGuard.js";

export interface ObservedRequest {
  method: string;
  url: string;
}

export interface EndpointRow {
  /** "METHOD /normalized/path" — the grouping key. */
  key: string;
  method: string;
  path: string;
  class: RequestClass;
  count: number;
  /** True when block-mode would ABORT this request (a Copper mutation shape). */
  blockedInBlockMode: boolean;
}

export interface EndpointReport {
  rows: EndpointRow[];
  /**
   * The finding that matters: Copper requests observed DURING A READ WALKTHROUGH
   * that block-mode would nonetheless abort. On a correct allowlist this is
   * empty; anything here is a read the guard does not yet recognise and must be
   * added before running the client account in block-mode.
   */
  readsBlockedByGuard: EndpointRow[];
  copperReadCount: number;
  copperMutationCount: number;
  nonCopperCount: number;
}

/**
 * Normalize a URL path so that per-record variation collapses to one row:
 * numeric ids → :id, long hex blobs → :hash. Keeps the endpoint shape while
 * grouping "…/people/123" and "…/people/456" together.
 */
export function normalizePath(rawUrl: string): string {
  let path: string;
  try {
    path = new URL(rawUrl).pathname;
  } catch {
    return "(unparseable)";
  }
  return path
    // A pure-numeric path segment is always a record id (api versions look like
    // "v1", not "1"), so collapse regardless of length.
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, "/:hash");
}

/**
 * Aggregate observed requests into a deduplicated, classified report. Every
 * classification goes through the SAME function the live guard uses, so the
 * report is a faithful prediction of block-mode behaviour — not a parallel guess.
 */
export function buildEndpointReport(observed: ObservedRequest[]): EndpointReport {
  const byKey = new Map<string, EndpointRow>();
  let copperReadCount = 0;
  let copperMutationCount = 0;
  let nonCopperCount = 0;

  for (const req of observed) {
    const cls = classifyCopperRequest(req.method, req.url);
    if (cls === "non-copper") nonCopperCount++;
    else if (cls === "copper-mutation") copperMutationCount++;
    else copperReadCount++;

    // Only Copper endpoints are worth tabulating for the allowlist decision.
    if (cls === "non-copper") continue;

    const method = req.method.toUpperCase();
    const path = normalizePath(req.url);
    const key = `${method} ${path}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count++;
    } else {
      byKey.set(key, {
        key,
        method,
        path,
        class: cls,
        count: 1,
        blockedInBlockMode: cls === "copper-mutation",
      });
    }
  }

  const rows = [...byKey.values()].sort(
    (a, b) => Number(b.blockedInBlockMode) - Number(a.blockedInBlockMode) || b.count - a.count,
  );
  return {
    rows,
    readsBlockedByGuard: rows.filter((r) => r.blockedInBlockMode),
    copperReadCount,
    copperMutationCount,
    nonCopperCount,
  };
}
