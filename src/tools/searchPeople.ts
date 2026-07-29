import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireAuthenticatedPage } from "../browser/sessionManager.js";
import { PeoplePage } from "../pages/peoplePage.js";
import { querySchema, limitSchema } from "../schemas/common.js";
import { okResult } from "../utils/response.js";
import { runTool } from "./_helpers.js";

export function registerSearchPeople(server: McpServer): void {
  server.registerTool(
    "search_people",
    {
      title: "Search People",
      description:
        "Find people (contacts) in Copper by name, email, or other free text via the web app's " +
        "search. Returns a list of matches with the record id, name, and record URL (plus any " +
        "other fields that can be reliably extracted). Use before logging an activity or creating " +
        "a task against a contact.",
      inputSchema: {
        query: querySchema,
        limit: limitSchema,
      },
    },
    async ({ query, limit }) =>
      runTool("search_people", async (log) => {
        const page = await requireAuthenticatedPage(log);
        const people = await new PeoplePage(page, log).search(query, limit);
        return okResult(
          people.length ? `Found ${people.length} people.` : "No people matched that search.",
          { people },
          { recordCount: people.length },
        );
      }),
  );
}
