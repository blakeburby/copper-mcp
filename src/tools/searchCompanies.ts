import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireAuthenticatedPage } from "../browser/sessionManager.js";
import { CompaniesPage } from "../pages/companiesPage.js";
import { querySchema, limitSchema } from "../schemas/common.js";
import { okResult } from "../utils/response.js";
import { runTool } from "./_helpers.js";

export function registerSearchCompanies(server: McpServer): void {
  server.registerTool(
    "search_companies",
    {
      title: "Search Companies",
      description:
        "Find companies (accounts) in Copper by name or other free text via the web app's search. " +
        "Returns matches with record id, name, and record URL (plus any other reliably-extractable " +
        "fields).",
      inputSchema: {
        query: querySchema,
        limit: limitSchema,
      },
    },
    async ({ query, limit }) =>
      runTool("search_companies", async (log) => {
        const page = await requireAuthenticatedPage(log);
        const companies = await new CompaniesPage(page, log).search(query, limit);
        return okResult(
          companies.length
            ? `Found ${companies.length} companies.`
            : "No companies matched that search.",
          { companies },
          { recordCount: companies.length },
        );
      }),
  );
}
