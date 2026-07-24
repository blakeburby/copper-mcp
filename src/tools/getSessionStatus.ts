import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSessionStatus } from "../browser/sessionManager.js";
import { okResult } from "../utils/response.js";
import { runTool } from "./_helpers.js";

export function registerGetSessionStatus(server: McpServer): void {
  server.registerTool(
    "get_copper_session_status",
    {
      title: "Get Copper Session Status",
      description:
        "Report whether the browser is running, whether the Copper session is authenticated, " +
        "whether it appears expired, and whether the current page is usable. Read-only; safe to " +
        "call any time.",
      inputSchema: {},
    },
    async () =>
      runTool("get_copper_session_status", async (log) => {
        const status = await getSessionStatus(log);
        const message = !status.browserRunning
          ? "Browser is not running. Run initialize_copper_session first."
          : status.authenticated
            ? "Authenticated Copper session is active."
            : status.sessionExpired
              ? "Session appears expired — re-run initialize_copper_session."
              : "Browser is running but not authenticated.";
        return okResult(message, status, { source: "copper-web-ui" });
      }),
  );
}
