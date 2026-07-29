import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireAuthenticatedPage } from "../browser/sessionManager.js";
import { OpportunitiesPage } from "../pages/opportunitiesPage.js";
import { okResult } from "../utils/response.js";
import { runTool } from "./_helpers.js";

export function registerGetOpportunity(server: McpServer): void {
  server.registerTool(
    "get_opportunity",
    {
      title: "Get Opportunity",
      description:
        "Open a single opportunity (deal) by its Copper id and return the reliably-extractable " +
        "details: name, company, pipeline, stage, status, owner, value, close date, primary " +
        "contact, tags, recent activities, and the record URL.",
      inputSchema: {
        opportunityId: z
          .string()
          .min(1)
          .describe("The Copper opportunity id (as shown in the record URL)."),
      },
    },
    async ({ opportunityId }) =>
      runTool("get_opportunity", async (log) => {
        const page = await requireAuthenticatedPage(log);
        const opportunity = await new OpportunitiesPage(page, log).get(opportunityId);
        return okResult(
          `Loaded opportunity "${opportunity.name ?? opportunityId}".`,
          { opportunity },
        );
      }),
  );
}
