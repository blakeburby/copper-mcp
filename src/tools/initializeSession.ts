import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { initializeSession } from "../browser/sessionManager.js";
import { okResult, toCallToolResult, fail } from "../utils/response.js";
import { runTool } from "./_helpers.js";

export function registerInitializeSession(server: McpServer): void {
  server.registerTool(
    "initialize_copper_session",
    {
      title: "Initialize Copper Session",
      description:
        "Open the Copper web app in a visible browser window and guide first-time login. " +
        "Sign in manually (password, Google SSO, and MFA are all supported) — this server " +
        "never handles your credentials. The authenticated session is saved to a persistent " +
        "browser profile and reused by every other tool. Run this once before using the other " +
        "tools, or again if your session has expired.",
      inputSchema: {},
    },
    async () =>
      runTool("initialize_copper_session", async (log) => {
        const result = await initializeSession({ log });
        if (result.success) {
          return okResult(result.message, {
            success: true,
            authenticated: result.authenticated,
            currentUrl: result.currentUrl,
          });
        }
        return toCallToolResult(
          fail("AUTHENTICATION_REQUIRED", result.message, `Current URL: ${result.currentUrl}`),
        );
      }),
  );
}
