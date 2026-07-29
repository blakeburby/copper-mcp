import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBrowserManager } from "../browser/browserManager.js";
import { captureDiagnostics } from "../browser/diagnostics.js";
import { okResult, toCallToolResult, fail } from "../utils/response.js";
import { runTool } from "./_helpers.js";

export function registerCaptureDiagnostics(server: McpServer): void {
  server.registerTool(
    "capture_copper_diagnostics",
    {
      title: "Capture Copper Diagnostics",
      description:
        "Debug helper. Save a timestamped screenshot (and a sanitized HTML snapshot) of the " +
        "current Copper page, plus its URL and title. Use this when a tool reports a selector or " +
        "layout failure so you can see what the browser is actually showing. Never writes cookies, " +
        "tokens, or form values into the artifacts.",
      inputSchema: {
        label: z
          .string()
          .optional()
          .describe("Optional label included in the artifact filename."),
        includeHtml: z
          .boolean()
          .default(true)
          .describe("Also save a sanitized HTML snapshot (default true)."),
      },
    },
    async ({ label, includeHtml }) =>
      runTool("capture_copper_diagnostics", async (log) => {
        const manager = getBrowserManager();
        if (!manager.isRunning()) {
          return toCallToolResult(
            fail(
              "BROWSER_FAILURE",
              "Browser is not running; nothing to capture.",
              "Run initialize_copper_session first.",
            ),
          );
        }
        const page = await manager.getPage();
        const diag = await captureDiagnostics(page, label ?? "manual", {
          includeHtml,
          logger: log,
        });
        return okResult("Diagnostics captured.", diag, { source: "copper-web-ui" });
      }),
  );
}
