import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireAuthenticatedPage } from "../browser/sessionManager.js";
import { loadConfig } from "../config.js";
import { okResult } from "../utils/response.js";
import { runTool } from "./_helpers.js";

/**
 * Non-destructive, one-call proof that the network write guard is live and
 * blocking — run this BEFORE pointing the server at a client account.
 *
 * It fires two SYNTHETIC requests from the page context and reports what the
 * guard did with each:
 *   - a POST to a deliberately non-existent Copper WRITE path. If the guard is
 *     active it is aborted before leaving the browser (fetch rejects). If it
 *     somehow reached Copper, that path 404s — there is no such resource, so no
 *     data can change either way.
 *   - a POST to a read-shaped path, to confirm reads are NOT collateral damage.
 *
 * This tool never touches a real record: the write probe targets a path that
 * does not exist, and the read probe is a search with an empty body.
 */
export function registerVerifyWriteGuard(server: McpServer): void {
  server.registerTool(
    "verify_write_guard",
    {
      title: "Verify Write Guard",
      description:
        "Prove the network write guard is active without touching any data. Fires a synthetic " +
        "POST to a non-existent Copper write path (must be blocked) and a read-shaped POST (must " +
        "be allowed), and reports the guard mode and both outcomes. Run this before enabling " +
        "writes or pointing the server at a production account.",
      inputSchema: {},
    },
    async () =>
      runTool("verify_write_guard", async (log) => {
        const cfg = loadConfig();
        // Land on the authenticated app shell so the account id is present in the
        // URL and the read probe can hit a real endpoint.
        const page = await requireAuthenticatedPage(log);

        const url = page.url();
        const origin = new URL(url).origin;
        // The account id is in the authenticated app-shell URL
        // (/companies/{id}/app…). Needed so the read probe hits a REAL endpoint
        // and can prove the guard let it through, rather than failing at the
        // server for an unrelated reason and looking "blocked".
        const accountId = url.match(/\/companies\/(\d+)\/app/)?.[1] ?? null;

        // "reached" = the request completed (any HTTP status — even 404/401 — is
        // a resolved fetch). "blocked" = the fetch threw, i.e. the guard aborted
        // it before it left the browser.
        const probe = async (path: string): Promise<"blocked" | "reached"> => {
          return page.evaluate(async (u) => {
            try {
              await fetch(u, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "{}",
                credentials: "include",
              });
              return "reached" as const;
            } catch {
              return "blocked" as const;
            }
          }, `${origin}${path}`);
        };

        // WRITE probe: a non-existent write path. Blocked by the guard before it
        // leaves the browser; even if it somehow reached Copper, the resource
        // does not exist, so nothing can change.
        const writeProbePath = "/api/v1/companies/__pace_guard_selftest__/activities_api/create";
        // READ probe: a REAL search endpoint (a read; no mutation) so that, when
        // the guard allows it, the request genuinely completes → "reached".
        const readProbePath = accountId
          ? `/api/v1/companies/${accountId}/contacts_api/search`
          : null;

        const blockedSynthetic = (await probe(writeProbePath)) === "blocked";
        const allowedRead =
          readProbePath === null ? null : (await probe(readProbePath)) === "reached";

        // The write-block is the safety-critical half. A null read probe (no
        // account id available) is "couldn't verify", not a failure.
        const healthy =
          cfg.writeGuard === "block" ? blockedSynthetic && allowedRead !== false : true;

        log.info("write guard self-test", {
          guardMode: cfg.writeGuard,
          blockedSynthetic,
          allowedRead,
        });

        const readNote =
          allowedRead === null
            ? " (read probe skipped — no account id in URL)"
            : allowedRead
              ? " and a read was allowed"
              : "";

        return okResult(
          cfg.writeGuard !== "block"
            ? `Write guard is in "${cfg.writeGuard}" mode — it is NOT blocking. Set COPPER_WRITE_GUARD=block (the read-only default) for a production account.`
            : healthy
              ? `Write guard is active: a synthetic write was blocked${readNote}.`
              : "WRITE GUARD SELF-TEST FAILED — the guard did not behave as expected. Do NOT run against a production account.",
          {
            guardMode: cfg.writeGuard,
            readOnly: cfg.readOnly,
            blockedSynthetic,
            allowedRead,
            healthy,
          },
          { source: "copper-web-ui" },
        );
      }),
  );
}
