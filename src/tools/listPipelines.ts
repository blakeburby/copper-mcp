import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireAuthenticatedPage } from "../browser/sessionManager.js";
import { OpportunitiesPage } from "../pages/opportunitiesPage.js";
import { okResult } from "../utils/response.js";
import { runTool } from "./_helpers.js";

export function registerListPipelines(server: McpServer): void {
  server.registerTool(
    "list_pipelines",
    {
      title: "List Pipelines",
      description:
        "List the opportunity pipelines and their visible stages, read from the Copper pipelines " +
        "settings screen. Useful before searching or filtering opportunities by pipeline/stage.",
      inputSchema: {},
    },
    async () =>
      runTool("list_pipelines", async (log) => {
        const page = await requireAuthenticatedPage(log);
        const pipelines = await new OpportunitiesPage(page, log).listPipelines();
        return okResult(
          pipelines.length ? `Found ${pipelines.length} pipelines.` : "No pipelines found.",
          { pipelines },
          { recordCount: pipelines.length },
        );
      }),
  );
}
