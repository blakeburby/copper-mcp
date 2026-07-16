#!/usr/bin/env node
/**
 * Copper CRM MCP server (unofficial).
 *
 * Registers a small, curated set of tools and speaks MCP over stdio so it drops
 * straight into Claude Desktop as a local subprocess. Read-heavy by design:
 * six read tools, one guarded write tool (log_activity).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerSearchPeople } from "./tools/searchPeople.js";
import { registerSearchCompanies } from "./tools/searchCompanies.js";
import { registerSearchOpportunities } from "./tools/searchOpportunities.js";
import { registerListPipelines } from "./tools/listPipelines.js";
import { registerGetOpportunity } from "./tools/getOpportunity.js";
import { registerCreateTask } from "./tools/createTask.js";
import { registerLogActivity } from "./tools/logActivity.js";

async function main(): Promise<void> {
  const server = new McpServer({
    name: "copper-mcp",
    version: "0.1.0",
  });

  // Read tools.
  registerSearchPeople(server);
  registerSearchCompanies(server);
  registerSearchOpportunities(server);
  registerListPipelines(server);
  registerGetOpportunity(server);
  registerCreateTask(server);

  // Write tool (the only one that mutates the CRM).
  registerLogActivity(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is the protocol channel — all logging must go to stderr.
  console.error("Copper MCP server running on stdio.");
}

main().catch((err) => {
  console.error("Fatal error starting Copper MCP server:", err);
  process.exit(1);
});
