import { describe, it, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerLogActivity } from "../../tools/logActivity.js";
import { registerCreateTask } from "../../tools/createTask.js";

type Handler = (input: Record<string, unknown>) => Promise<CallToolResult>;

/**
 * Minimal fake MCP server that captures registered tool handlers so we can invoke
 * them directly. It does NOT run Zod parsing, so tests pass fully-formed inputs.
 */
function fakeServer(): { handlers: Record<string, Handler>; server: McpServer } {
  const handlers: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _def: unknown, handler: Handler) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  return { handlers, server };
}

function body(result: CallToolResult) {
  const first = result.content[0] as { type: "text"; text: string };
  return JSON.parse(first.text);
}

describe("write-confirmation enforcement", () => {
  it("log_activity with confirm=false returns a preview and does NOT submit", async () => {
    const { handlers, server } = fakeServer();
    registerLogActivity(server);
    const result = await handlers["log_activity"]({
      parentType: "person",
      parentId: "123",
      activityType: "Note",
      details: "Called about renewal",
      confirm: false,
    });
    const b = body(result);
    expect(result.isError).toBe(false);
    expect(b.success).toBe(true);
    expect(b.meta.confirmed).toBe(false);
    expect(b.data.preview.willSubmit).toBe(false);
    expect(b.data.preview.action).toBe("log_activity");
    expect(b.message).toMatch(/not logged/i);
  });

  it("create_task with confirm=false returns a preview and does NOT submit", async () => {
    const { handlers, server } = fakeServer();
    registerCreateTask(server);
    const result = await handlers["create_task"]({
      title: "Follow up",
      parentType: "opportunity",
      parentId: "999",
      confirm: false,
    });
    const b = body(result);
    expect(result.isError).toBe(false);
    expect(b.success).toBe(true);
    expect(b.meta.confirmed).toBe(false);
    expect(b.data.preview.willSubmit).toBe(false);
    expect(b.data.preview.action).toBe("create_task");
    expect(b.message).toMatch(/not created/i);
  });
});
