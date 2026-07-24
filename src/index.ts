#!/usr/bin/env node
/**
 * Copper CRM MCP server (unofficial, browser-automation edition).
 *
 * Drives the Copper WEB APP with Playwright through a persistent, manually
 * authenticated browser session — no API key, no Copper developer access. Speaks
 * MCP over stdio so it drops straight into Claude Desktop / Claude Code as a local
 * subprocess.
 *
 * Read-heavy by design: session + diagnostics tools, six read tools, and two
 * confirm-gated write tools (log_activity, create_task).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { rootLogger } from "./utils/logger.js";
import { getBrowserManager } from "./browser/browserManager.js";

// Session / diagnostics
import { registerInitializeSession } from "./tools/initializeSession.js";
import { registerGetSessionStatus } from "./tools/getSessionStatus.js";
import { registerCaptureDiagnostics } from "./tools/captureDiagnostics.js";

// Read tools
import { registerSearchPeople } from "./tools/searchPeople.js";
import { registerGetPerson } from "./tools/getPerson.js";
import { registerSearchCompanies } from "./tools/searchCompanies.js";
import { registerSearchOpportunities } from "./tools/searchOpportunities.js";
import { registerListPipelines } from "./tools/listPipelines.js";
import { registerGetOpportunity } from "./tools/getOpportunity.js";

// Write tools (confirm-gated)
import { registerLogActivity } from "./tools/logActivity.js";
import { registerCreateTask } from "./tools/createTask.js";

async function main(): Promise<void> {
  const server = new McpServer({
    name: "copper-mcp",
    version: "0.2.0",
  });

  // Session + diagnostics.
  registerInitializeSession(server);
  registerGetSessionStatus(server);
  registerCaptureDiagnostics(server);

  // Read tools.
  registerSearchPeople(server);
  registerGetPerson(server);
  registerSearchCompanies(server);
  registerSearchOpportunities(server);
  registerListPipelines(server);
  registerGetOpportunity(server);

  // Write tools (the only ones that mutate the CRM; both confirm-gated).
  registerLogActivity(server);
  registerCreateTask(server);

  // Ensure the browser is closed when the MCP transport goes away.
  server.server.onclose = () => {
    void getBrowserManager().close();
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is the protocol channel — all logging must go to stderr.
  rootLogger.info("Copper MCP server (Playwright edition) running on stdio.");
}

main().catch((err) => {
  rootLogger.error("Fatal error starting Copper MCP server", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
