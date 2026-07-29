import { describe, it, expect } from "vitest";
import { normalizePath, buildEndpointReport } from "../../browser/endpointReport.js";

/**
 * The onboarding report must (a) group per-record variation into one row and
 * (b) flag exactly the reads that block-mode would wrongly stop — the finding an
 * operator acts on before going live. It classifies through the live guard's own
 * function, so these also pin that the report and the guard never diverge.
 */

describe("normalizePath", () => {
  it("collapses numeric ids and hex blobs so records group into one endpoint", () => {
    expect(normalizePath("https://app.copper.com/api/v1/companies/616931/contacts_api/search")).toBe(
      "/api/v1/companies/:id/contacts_api/search",
    );
    expect(normalizePath("https://app.copper.com/api/v1/people/184433443")).toBe(
      "/api/v1/people/:id",
    );
    expect(normalizePath("https://app.copper.com/a/deadbeefdeadbeefcafe/x")).toBe("/a/:hash/x");
  });

  it("does not mangle short numbers like api versions", () => {
    expect(normalizePath("https://app.copper.com/api/v1/x")).toBe("/api/v1/x");
  });
});

describe("buildEndpointReport", () => {
  it("dedupes across records and counts occurrences", () => {
    const rep = buildEndpointReport([
      { method: "POST", url: "https://app.copper.com/api/v1/companies/1/contacts_api/search" },
      { method: "POST", url: "https://app.copper.com/api/v1/companies/2/contacts_api/search" },
    ]);
    expect(rep.rows).toHaveLength(1);
    expect(rep.rows[0].count).toBe(2);
    expect(rep.rows[0].class).toBe("copper-read-post");
    expect(rep.rows[0].blockedInBlockMode).toBe(false);
  });

  it("flags a READ that block-mode would wrongly block (the allowlist gap)", () => {
    const rep = buildEndpointReport([
      // A hypothetical read op the allowlist does not recognise → looks like a mutation.
      { method: "POST", url: "https://app.copper.com/api/v1/companies/1/leads_api/fetch_all" },
    ]);
    expect(rep.readsBlockedByGuard).toHaveLength(1);
    expect(rep.readsBlockedByGuard[0].path).toBe("/api/v1/companies/:id/leads_api/fetch_all");
    expect(rep.copperMutationCount).toBe(1);
  });

  it("recognises the known read families as allowed", () => {
    const rep = buildEndpointReport([
      { method: "POST", url: "https://app.copper.com/api/v1/companies/1/contacts_api/search" },
      { method: "GET", url: "https://app.copper.com/api/v1/companies/1/people/9" },
      { method: "POST", url: "https://app.copper.com/api/v1/companies/1/reports_api/activity_by_user" },
    ]);
    expect(rep.readsBlockedByGuard).toHaveLength(0);
    expect(rep.copperReadCount).toBe(3);
  });

  it("does not tabulate non-Copper traffic (analytics, Intercom) but counts it", () => {
    const rep = buildEndpointReport([
      { method: "POST", url: "https://api-iam.intercom.io/messenger/web/metrics" },
      { method: "GET", url: "https://fonts.gstatic.com/s/x.woff2" },
    ]);
    expect(rep.rows).toHaveLength(0);
    expect(rep.nonCopperCount).toBe(2);
  });

  it("sorts blocked reads first so the operator sees the gaps at the top", () => {
    const rep = buildEndpointReport([
      { method: "POST", url: "https://app.copper.com/api/v1/companies/1/contacts_api/search" },
      { method: "POST", url: "https://app.copper.com/api/v1/companies/1/leads_api/fetch_all" },
    ]);
    expect(rep.rows[0].blockedInBlockMode).toBe(true);
  });
});
