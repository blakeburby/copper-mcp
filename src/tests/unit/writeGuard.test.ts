import { describe, it, expect, vi } from "vitest";
import { installWriteGuard, type WriteGuardMode } from "../../browser/writeGuard.js";
import { createLogger } from "../../utils/logger.js";

/**
 * The write guard is the network backstop for a full-write login. These tests
 * pin its decisions: what it blocks, what it lets through, and that reads are
 * never touched.
 */

interface FakeRoute {
  continued: boolean;
  aborted: string | null;
}

/** Drive the guard's route handler with a fabricated request. */
async function run(mode: WriteGuardMode, method: string, url: string) {
  let handler: ((route: unknown, request: unknown) => Promise<void>) | undefined;
  const context = {
    route: async (_pattern: string, h: typeof handler) => {
      handler = h;
    },
  } as unknown as import("playwright").BrowserContext;

  const stats = await installWriteGuard(context, mode, createLogger());
  if (!handler) return { stats, route: null as FakeRoute | null };

  const route: FakeRoute = { continued: false, aborted: null };
  const fakeRoute = {
    continue: async () => {
      route.continued = true;
    },
    abort: async (reason: string) => {
      route.aborted = reason;
    },
  };
  const fakeRequest = { method: () => method, url: () => url };
  await handler(fakeRoute, fakeRequest);
  return { stats, route };
}

describe("write guard — what it blocks", () => {
  it("aborts a POST to a non-read Copper path (probable write) in block mode", async () => {
    const { stats, route } = await run("block", "POST", "https://app.copper.com/api/v1/companies/1/activities");
    expect(route!.aborted).toBe("blockedbyclient");
    expect(route!.continued).toBe(false);
    expect(stats.mutatingBlocked).toBe(1);
  });

  it("aborts PUT, PATCH and DELETE to Copper — reads never use these", async () => {
    for (const m of ["PUT", "PATCH", "DELETE"]) {
      const { route } = await run("block", m, "https://app.copper.com/api/v1/companies/1/people/1");
      expect(route!.aborted, m).toBe("blockedbyclient");
    }
  });

  it("matches Copper subdomains too", async () => {
    const { route } = await run("block", "PUT", "https://api.copper.com/v1/tasks/1");
    expect(route!.aborted).toBe("blockedbyclient");
  });

  // The hole that was closed: the earlier classifier allowed ANY path containing
  // `_api/`, so a WRITE namespaced under `_api/` slipped through. These must now
  // be blocked — reads are recognised by their QUERY shape, not by `_api/`.
  it("BLOCKS a write that is namespaced under _api/ (the closed hole)", async () => {
    const writes = [
      "https://app.copper.com/api/v1/companies/1/activities_api/create",
      "https://app.copper.com/api/v1/companies/1/contacts_api/update",
      "https://app.copper.com/api/v1/companies/1/tasks_api/save",
      "https://app.copper.com/api/v1/companies/1/activities_api/1/delete",
      "https://app.copper.com/api/v1/companies/1/activities", // bare resource POST
    ];
    for (const url of writes) {
      const { route } = await run("block", "POST", url);
      expect(route!.aborted, url).toBe("blockedbyclient");
      expect(route!.continued, url).toBe(false);
    }
  });
});

describe("write guard — Copper reads via POST must survive", () => {
  // VERIFIED live (full read-only sync): these are Copper's real read endpoints,
  // recognised by their QUERY shape (/search, reports_api, analytics), not by a
  // blanket _api/ match. Blocking them would break every read.
  const READ_POSTS = [
    "https://app.copper.com/api/v1/companies/616931/contacts_api/search",
    "https://app.copper.com/api/v1/companies/616931/tasks_api/search",
    "https://app.copper.com/api/v1/companies/616931/agenda_items_api/search",
    "https://app.copper.com/api/v1/companies/616931/contact_suggestions_api/search",
    "https://app.copper.com/api/v1/companies/616931/reports_api/activity_by_user",
    "https://app.copper.com/api/v2/companies/616931/analytics/track",
  ];

  it("lets every observed read-POST through in block mode", async () => {
    for (const url of READ_POSTS) {
      const { stats, route } = await run("block", "POST", url);
      expect(route!.continued, url).toBe(true);
      expect(route!.aborted).toBeNull();
      expect(stats.mutatingBlocked).toBe(0);
    }
  });
});

describe("write guard — what it must NOT block", () => {
  it("lets GET requests through — reads are never touched", async () => {
    const { route } = await run("block", "GET", "https://app.copper.com/api/v3/people/1");
    expect(route!.continued).toBe(true);
    expect(route!.aborted).toBeNull();
  });

  it("lets a POST to a THIRD-PARTY host through (analytics, Intercom)", async () => {
    // Blocking these could break the app and they never touch CRM data.
    for (const url of [
      "https://analytics.google.com/g/collect",
      "https://api-iam.intercom.io/messenger/web/metrics",
      "https://px.ads.linkedin.com/wa/",
    ]) {
      const { route } = await run("block", "POST", url);
      expect(route!.continued, url).toBe(true);
      expect(route!.aborted).toBeNull();
    }
  });

  it("does not falsely match a lookalike host", async () => {
    const { route } = await run("block", "POST", "https://notcopper.com.evil.example/x");
    expect(route!.continued).toBe(true);
  });
});

describe("write guard — audit vs off", () => {
  it("audit mode allows the write but records it", async () => {
    const { stats, route } = await run("audit", "POST", "https://app.copper.com/api/v1/companies/1/activities");
    expect(route!.continued).toBe(true);
    expect(route!.aborted).toBeNull();
    expect(stats.mutatingSeen).toBe(1);
    expect(stats.mutatingBlocked).toBe(0);
    expect(stats.samples[0]).toBe("POST /api/v1/companies/1/activities");
  });

  it("off mode installs no route at all", async () => {
    const route = vi.fn();
    const context = { route } as unknown as import("playwright").BrowserContext;
    const stats = await installWriteGuard(context, "off", createLogger());
    expect(route).not.toHaveBeenCalled();
    expect(stats.mutatingSeen).toBe(0);
  });

  it("records only the path, never the query string", async () => {
    const { stats } = await run("audit", "POST", "https://app.copper.com/api/v3/x?secret=abc123");
    expect(stats.samples[0]).toBe("POST /api/v3/x");
    expect(stats.samples[0]).not.toContain("secret");
  });
});
