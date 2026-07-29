import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Request } from "playwright";
import { requireAuthenticatedPage } from "../browser/sessionManager.js";
import { loadConfig } from "../config.js";
import { buildEndpointReport, type ObservedRequest } from "../browser/endpointReport.js";
import { PeoplePage } from "../pages/peoplePage.js";
import { ActivityFeedPage } from "../pages/activityFeedPage.js";
import { CompaniesPage } from "../pages/companiesPage.js";
import { OpportunitiesPage } from "../pages/opportunitiesPage.js";
import { okResult } from "../utils/response.js";
import { runTool } from "./_helpers.js";
import type { Logger } from "../utils/logger.js";

/**
 * Onboarding discovery — the READ-ONLY gate before pointing the server at a
 * client account in block-mode.
 *
 * The write guard's read allowlist and every page-object selector were verified
 * against a tiny dev account. A real client's Copper has more record types,
 * custom fields, and possibly different API shapes. This tool finds out what
 * THEIR account actually does, safely:
 *
 *   1. It passively OBSERVES every network request while it drives a sequence of
 *      READ flows (list people, open a record, read the activity feed, search
 *      companies/opportunities, list pipelines). It never mutates anything.
 *   2. It classifies each observed Copper request through the SAME function the
 *      live guard uses, and reports which ones block-mode would ABORT.
 *   3. It reports which selectors resolved on this account and which did not.
 *
 * The key output is `readsBlockedByGuard`: Copper reads that fired during a
 * read-only walkthrough yet block-mode would stop. On a correct allowlist that
 * list is empty; anything in it is exactly what must be added to
 * isKnownReadPost before the client runs in block-mode — caught here, read-only,
 * instead of as a starved sync against real revenue.
 *
 * Run this with COPPER_WRITE_GUARD=audit so an unrecognised read is still allowed
 * to complete and can be observed. In block-mode the tool still works but warns
 * that an unknown read may have been aborted mid-walkthrough, hiding it.
 */
interface SelectorCheck {
  step: string;
  ok: boolean;
  detail: string;
}

export function registerDiscoverReadEndpoints(server: McpServer): void {
  server.registerTool(
    "discover_read_endpoints",
    {
      title: "Discover Read Endpoints (onboarding)",
      description:
        "READ-ONLY onboarding audit. Drives the read flows against the connected account while " +
        "observing all network traffic, then reports (a) every Copper endpoint seen and whether " +
        "block-mode would allow or block it, (b) any READ that block-mode would wrongly block " +
        "(allowlist gaps to fix before going live), and (c) which selectors resolved on this " +
        "account. Run with COPPER_WRITE_GUARD=audit during client onboarding. Mutates nothing.",
      inputSchema: {},
    },
    async () =>
      runTool("discover_read_endpoints", async (log) => {
        const cfg = loadConfig();
        const page = await requireAuthenticatedPage(log);
        const context = page.context();

        // Passive observation: a request LISTENER never blocks or delays traffic
        // (unlike a route handler). We only record method + url.
        const observed: ObservedRequest[] = [];
        const onRequest = (req: Request) => {
          observed.push({ method: req.method(), url: req.url() });
        };
        context.on("request", onRequest);

        const checks: SelectorCheck[] = [];
        try {
          await runWalkthrough(page, log, checks);
        } finally {
          context.off("request", onRequest);
        }

        const report = buildEndpointReport(observed);

        const guardWarning =
          cfg.writeGuard === "block"
            ? "Guard is in BLOCK mode — an unrecognised read may have been aborted DURING this " +
              "walkthrough, so it would not appear as traffic. Re-run with COPPER_WRITE_GUARD=audit " +
              "for a complete picture."
            : null;

        const selectorsFailed = checks.filter((c) => !c.ok);
        const healthy = report.readsBlockedByGuard.length === 0 && selectorsFailed.length === 0;

        const message = healthy
          ? `Discovery clean: ${report.rows.length} Copper endpoint(s) observed, none of them a ` +
            `read that block-mode would stop, and all ${checks.length} selector checks passed. ` +
            `This account looks ready for block-mode.`
          : [
              report.readsBlockedByGuard.length
                ? `${report.readsBlockedByGuard.length} READ endpoint(s) would be BLOCKED by block-mode — ` +
                  `add them to isKnownReadPost before going live.`
                : "",
              selectorsFailed.length
                ? `${selectorsFailed.length} selector check(s) failed on this account — those reads ` +
                  `need selector work before a reliable sync.`
                : "",
            ]
              .filter(Boolean)
              .join(" ");

        log.info("discovery complete", {
          endpoints: report.rows.length,
          readsBlockedByGuard: report.readsBlockedByGuard.length,
          selectorsFailed: selectorsFailed.length,
          guardMode: cfg.writeGuard,
        });

        return okResult(
          message,
          {
            healthy,
            guardMode: cfg.writeGuard,
            guardWarning,
            selectorChecks: checks,
            readsBlockedByGuard: report.readsBlockedByGuard,
            endpoints: report.rows,
            counts: {
              copperReadRequests: report.copperReadCount,
              copperMutationRequests: report.copperMutationCount,
              nonCopperRequests: report.nonCopperCount,
              distinctCopperEndpoints: report.rows.length,
            },
          },
          { source: "copper-web-ui" },
        );
      }),
  );
}

/**
 * Drive the read flows. Each step is isolated: one failing selector records a
 * failed check and the walkthrough continues, so a single broken flow does not
 * blind the rest of the audit.
 */
async function runWalkthrough(
  page: import("playwright").Page,
  log: Logger,
  checks: SelectorCheck[],
): Promise<void> {
  const step = async <T>(name: string, fn: () => Promise<T>, describe: (r: T) => string) => {
    try {
      const r = await fn();
      checks.push({ step: name, ok: true, detail: describe(r) });
      return r;
    } catch (err) {
      checks.push({ step: name, ok: false, detail: err instanceof Error ? err.message : String(err) });
      return null;
    }
  };

  const people = new PeoplePage(page, log);

  const roster = await step(
    "list_people",
    () => people.list(200),
    (r) => `${r.people.length} row(s) enumerated (complete=${r.complete})`,
  );

  const first = roster?.people.find((p) => p.id);
  if (first?.id) {
    await step(
      "get_person (record fields)",
      () => people.get(first.id as string),
      (r) => {
        const resolved = (["title", "companyName", "email", "phone", "owner"] as const).filter(
          (k) => r[k],
        );
        return `name + [${resolved.join(", ") || "no other fields"}] resolved on record ${first.id}`;
      },
    );

    await step(
      "get_person_activities (feed)",
      () => new ActivityFeedPage(page, log).readFeed("person", first.id as string, { limit: 25 }),
      (r) => `feedState=${r.feedState}, itemsSeen=${r.itemsSeen}, itemsParsed=${r.itemsParsed}`,
    );
  } else {
    checks.push({
      step: "get_person / activities",
      ok: false,
      detail: "Skipped — the People list returned no record with an id to open.",
    });
  }

  await step(
    "search_companies",
    () => new CompaniesPage(page, log).search("a", 10),
    (r) => `${r.length} company result(s) for a broad query`,
  );

  await step(
    "search_opportunities",
    () => new OpportunitiesPage(page, log).search({ query: "a", limit: 10 }),
    (r) => `${r.length} opportunity result(s) for a broad query`,
  );

  await step(
    "list_pipelines",
    () => new OpportunitiesPage(page, log).listPipelines(),
    (r) => `${r.length} pipeline(s) resolved`,
  );
}
