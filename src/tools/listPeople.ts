import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireAuthenticatedPage } from "../browser/sessionManager.js";
import { PeoplePage } from "../pages/peoplePage.js";
import { limitSchema } from "../schemas/common.js";
import { okResult } from "../utils/response.js";
import { runTool } from "./_helpers.js";

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
        "List people from the Copper People view without searching. Use this to enumerate " +
        "contacts for a bulk sync; use search_people when looking for someone specific. " +
        "Returns record id, name and record URL per contact.",
      inputSchema: { limit: limitSchema },
    },
    async ({ limit }) =>
      runTool("list_people", async (log) => {
        const page = await requireAuthenticatedPage(log);
        const people = await new PeoplePage(page, log).list(limit);
        return okResult(
          people.length ? `Listed ${people.length} people.` : "No people found in the list view.",
          { people },
          { recordCount: people.length },
        );
      }),
  );
}
