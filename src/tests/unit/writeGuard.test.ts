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
});

describe("write guard — Copper reads via POST must survive", () => {
  // VERIFIED live: Copper's read path is POST to the *_api/ namespace. Blocking
  // these would break every read, so they must pass untouched.
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
