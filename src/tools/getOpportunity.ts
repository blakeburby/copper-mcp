import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { copperRequest } from "../copperClient.js";
import type { CopperOpportunity } from "../copperTypes.js";
import { errorResult, textResult } from "./result.js";

export function registerGetOpportunity(server: McpServer): void {
  server.registerTool(
    "get_opportunity",
    {
      title: "Get Opportunity",
      description:
        "Fetch the full detail of a single opportunity (deal) by its id — including custom " +
        "fields, tags, status, monetary value, close date, primary contact, and the last " +
        "activity dates you need to spot stale deals. Use this after search_opportunities to " +
        "drill into one deal.",
      inputSchema: {
        id: z
          .number()
          .int()
          .describe("The Copper opportunity id (from search_opportunities)."),
      },
    },
    async ({ id }) => {
      try {
        const opportunity = await copperRequest<CopperOpportunity>(
          "GET",
          `/opportunities/${id}`,
        );
        return textResult(opportunity);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
