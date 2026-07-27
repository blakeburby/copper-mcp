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
import { loadConfig } from "./config.js";
import { getBrowserManager } from "./browser/browserManager.js";

// Session / diagnostics
import { registerInitializeSession } from "./tools/initializeSession.js";
import { registerGetSessionStatus } from "./tools/getSessionStatus.js";
import { registerCaptureDiagnostics } from "./tools/captureDiagnostics.js";

// Read tools
import { registerSearchPeople } from "./tools/searchPeople.js";
import { registerGetPerson } from "./tools/getPerson.js";
import { registerListPeople } from "./tools/listPeople.js";
import { registerGetPersonActivities } from "./tools/getPersonActivities.js";
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
    version: "0.3.0",
  });

  // Session + diagnostics.
  registerInitializeSession(server);
  registerGetSessionStatus(server);
  registerCaptureDiagnostics(server);

  // Read tools.
  registerSearchPeople(server);
  registerGetPerson(server);
  registerGetPersonActivities(server);
  registerListPeople(server);
  registerSearchCompanies(server);
  registerSearchOpportunities(server);
  registerListPipelines(server);
  registerGetOpportunity(server);

  // Write tools (the only ones that mutate the CRM). Two locks, deliberately:
  //  - COPPER_READ_ONLY (default TRUE) prevents them from being REGISTERED at
  //    all — an MCP client that connects cannot even see them, let alone call
  //    them. Structural, not policy.
  //  - Even if a caller reached the page-object methods some other way, they
  //    also throw at entry when read-only is on (see activitiesPage / tasksPage).
  //  - When registration IS enabled, both still require confirm:true per call.
  const cfg = loadConfig();
  if (!cfg.readOnly) {
    registerLogActivity(server);
    registerCreateTask(server);
    rootLogger.warn("COPPER_READ_ONLY=false — write tools log_activity and create_task ARE registered.");
  } else {
    rootLogger.info("Read-only mode: write tools are NOT registered.");
  }

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
