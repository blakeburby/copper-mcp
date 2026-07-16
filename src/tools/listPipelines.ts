import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { copperRequest } from "../copperClient.js";
import type { CopperPipeline } from "../copperTypes.js";
import { errorResult, textResult } from "./result.js";

export function registerListPipelines(server: McpServer): void {
  server.registerTool(
    "list_pipelines",
    {
      title: "List Pipelines",
      description:
        "List every sales pipeline in Copper along with its ordered stages. Call this first " +
        "when you need to map a human stage or pipeline name (e.g. 'Closing this month') to " +
        "the numeric IDs that search_opportunities and get_opportunity use. Returns each " +
        "pipeline's id and name, plus each stage's id, name, and win_probability. Takes no arguments.",
      inputSchema: {},
    },
    async () => {
      try {
        const pipelines = await copperRequest<CopperPipeline[]>("GET", "/pipelines");

        const rows = pipelines.map((p) => ({
          id: p.id,
          name: p.name,
          stages: (p.stages ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            win_probability: s.win_probability ?? null,
          })),
        }));
        return textResult(rows);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
