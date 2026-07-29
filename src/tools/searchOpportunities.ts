import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireAuthenticatedPage } from "../browser/sessionManager.js";
import { OpportunitiesPage } from "../pages/opportunitiesPage.js";
import { limitSchema } from "../schemas/common.js";
import { okResult } from "../utils/response.js";
import { runTool } from "./_helpers.js";

export function registerSearchOpportunities(server: McpServer): void {
  server.registerTool(
    "search_opportunities",
    {
      title: "Search Opportunities",
      description:
        "Find opportunities (deals) in Copper. Accepts a free-text query plus optional filter hints " +
        "(pipeline, stage, owner, status, close-date range). Filters are applied best-effort through " +
        "the web app's search; any that can't be applied reliably are reported back in the response " +
        "meta rather than silently ignored. Returns matches with record id, name, and record URL.",
      inputSchema: {
        query: z.string().trim().optional().describe("Free-text search query."),
        pipeline: z.string().trim().optional().describe("Pipeline name filter hint."),
        stage: z.string().trim().optional().describe("Stage name filter hint."),
        owner: z.string().trim().optional().describe("Owner name filter hint."),
        status: z
          .string()
          .trim()
          .optional()
          .describe("Status filter hint (e.g. open, won, lost)."),
        closeDateFrom: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Close-date range start (YYYY-MM-DD)."),
        closeDateTo: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Close-date range end (YYYY-MM-DD)."),
        limit: limitSchema,
      },
    },
    async (input) =>
      runTool("search_opportunities", async (log) => {
        const page = await requireAuthenticatedPage(log);
        const opportunities = await new OpportunitiesPage(page, log).search(input);

        // Which filters were provided but can only be applied as text hints.
        const bestEffortFilters = Object.entries({
          pipeline: input.pipeline,
          stage: input.stage,
          owner: input.owner,
          status: input.status,
          closeDateFrom: input.closeDateFrom,
          closeDateTo: input.closeDateTo,
        })
          .filter(([, v]) => !!v)
          .map(([k]) => k);

        return okResult(
          opportunities.length
            ? `Found ${opportunities.length} opportunities.`
            : "No opportunities matched that search.",
          { opportunities },
          {
            recordCount: opportunities.length,
            bestEffortFilters,
            filterNote:
              bestEffortFilters.length > 0
                ? "These filters were applied as text hints only; verify results match the intended filter."
                : undefined,
          },
        );
      }),
  );
}
