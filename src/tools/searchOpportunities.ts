import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { copperRequest } from "../copperClient.js";
import type { CopperOpportunity } from "../copperTypes.js";
import { errorResult, textResult } from "./result.js";

export function registerSearchOpportunities(server: McpServer): void {
  server.registerTool(
    "search_opportunities",
    {
      title: "Search Opportunities",
      description:
        "List and filter opportunities (deals) in Copper. Filter by pipeline, stage, or " +
        "assignee to triage a book of business. Returns each deal's id, name, monetary_value, " +
        "pipeline_id, pipeline_stage_id, close_date, company_name, and assignee_id. " +
        "Stage and pipeline are returned as IDs — call list_pipelines to map them to names. " +
        "Use get_opportunity for the full record (custom fields, tags, contacts).",
      inputSchema: {
        pipeline_id: z
          .number()
          .int()
          .optional()
          .describe("Restrict to a single pipeline (get IDs from list_pipelines)."),
        pipeline_stage_id: z
          .number()
          .int()
          .optional()
          .describe("Restrict to a single stage within a pipeline."),
        assignee_id: z
          .number()
          .int()
          .optional()
          .describe("Restrict to deals owned by a specific Copper user."),
        page_size: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Maximum number of opportunities to return (default 20)."),
      },
    },
    async ({ pipeline_id, pipeline_stage_id, assignee_id, page_size }) => {
      try {
        // Copper's search endpoint takes plural array filters; expose singular args
        // to the agent and wrap them here.
        const body: Record<string, unknown> = {
          page_size: page_size ?? 20,
        };
        if (pipeline_id !== undefined) body.pipeline_ids = [pipeline_id];
        if (pipeline_stage_id !== undefined) body.pipeline_stage_ids = [pipeline_stage_id];
        if (assignee_id !== undefined) body.assignee_ids = [assignee_id];

        const opportunities = await copperRequest<CopperOpportunity[]>(
          "POST",
          "/opportunities/search",
          body,
        );

        if (!opportunities.length) return textResult("No opportunities matched that filter.");

        const rows = opportunities.map((o) => ({
          id: o.id,
          name: o.name,
          monetary_value: o.monetary_value ?? null,
          pipeline_id: o.pipeline_id ?? null,
          pipeline_stage_id: o.pipeline_stage_id ?? null,
          close_date: o.close_date ?? null,
          company_name: o.company_name ?? null,
          assignee_id: o.assignee_id ?? null,
        }));
        return textResult(rows);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
