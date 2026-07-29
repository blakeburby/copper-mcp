import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireAuthenticatedPage } from "../browser/sessionManager.js";
import { PeoplePage } from "../pages/peoplePage.js";
import { okResult } from "../utils/response.js";
import { runTool } from "./_helpers.js";

/**
 * Enumeration cap — a SAFETY ceiling on how many records to scroll through, not a
 * page size. Defaults high so a real roster of thousands enumerates fully; the
 * `complete` flag in the result tells the caller whether this cap truncated it.
 */
const enumerationCapSchema = z
  .number()
  .int()
  .positive()
  .max(50_000)
  .default(5_000)
  .describe("Safety ceiling on records to enumerate (default 5000). If hit, the result is truncated.");

/**
 * Enumerate people from the People list view.
 *
 * Distinct from search_people, which requires a query: a query that happens to
 * match nothing is indistinguishable from an empty CRM, which makes search a
 * poor basis for "sync everyone". This loads the list itself.
 */
export function registerListPeople(server: McpServer): void {
  server.registerTool(
    "list_people",
    {
      title: "List People",
      description:
        "List people from the Copper People view without searching. Scrolls to enumerate the " +
        "WHOLE roster (Copper virtualizes the list), for a bulk sync; use search_people when " +
        "looking for someone specific. Returns record id, name and record URL per contact, plus " +
        "`complete`: true when the end of the list was reached, false when the cap truncated it — " +
        "a truncated roster must never be treated as the whole account.",
      inputSchema: { cap: enumerationCapSchema },
    },
    async ({ cap }) =>
      runTool("list_people", async (log) => {
        const page = await requireAuthenticatedPage(log);
        const { people, complete } = await new PeoplePage(page, log).list(cap);
        const suffix = complete ? "" : ` (TRUNCATED at cap ${cap} — more exist)`;
        return okResult(
          people.length ? `Listed ${people.length} people${suffix}.` : "No people found in the list view.",
          { people, complete },
          { recordCount: people.length, complete },
        );
      }),
  );
}
