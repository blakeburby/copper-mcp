import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { copperRequest, CopperApiError } from "../copperClient.js";
import { errorResult, textResult } from "./result.js";

/** Convert an ISO date (or date-time) string to the Unix seconds Copper expects. */
function toUnixSeconds(dateStr: string): number {
  const ms = Date.parse(dateStr);
  if (Number.isNaN(ms)) {
    throw new CopperApiError(
      0,
      `Invalid due_date "${dateStr}". Use an ISO date like 2026-07-17.`,
    );
  }
  return Math.floor(ms / 1000);
}

export function registerCreateTask(server: McpServer): void {
  server.registerTool(
    "create_task",
    {
      title: "Create Task",
      description:
        "Create a follow-up task in Copper, optionally linked to a person, company, or " +
        "opportunity. Use this to schedule a reminder (e.g. 'send pricing on Friday'). " +
        "Returns the created task. This tool creates a task record but does not modify any " +
        "existing CRM data.",
      inputSchema: {
        name: z.string().describe("The task title, e.g. 'Send pricing to Acme'."),
        related_resource: z
          .object({
            id: z.number().int().describe("The id of the record to link this task to."),
            type: z
              .enum(["person", "company", "opportunity", "lead", "project"])
              .describe("The kind of record being linked."),
          })
          .optional()
          .describe("Optionally link the task to a CRM record."),
        due_date: z
          .string()
          .optional()
          .describe("Due date in ISO format, e.g. '2026-07-17'."),
        details: z
          .string()
          .optional()
          .describe("Free-text notes / description for the task."),
      },
    },
    async ({ name, related_resource, due_date, details }) => {
      try {
        const body: Record<string, unknown> = { name };
        if (related_resource) body.related_resource = related_resource;
        if (due_date) body.due_date = toUnixSeconds(due_date);
        if (details) body.details = details;

        const task = await copperRequest("POST", "/tasks", body);
        return textResult(task);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
