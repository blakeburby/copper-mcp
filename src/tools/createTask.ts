import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBrowserManager } from "../browser/browserManager.js";
import { requireAuthenticatedPage } from "../browser/sessionManager.js";
import { TasksPage } from "../pages/tasksPage.js";
import { parentTypeSchema, confirmSchema, dateStringSchema } from "../schemas/common.js";
import { okResult } from "../utils/response.js";
import type { WritePreview } from "../types/records.js";
import { runTool } from "./_helpers.js";

/**
 * WRITE TOOL. Creates a task attached to a record via the web UI. Requires
 * confirm=true, holds the mutation lock, checks for a same-title duplicate first,
 * submits once, and verifies. Never blindly re-submits.
 */
export function registerCreateTask(server: McpServer): void {
  server.registerTool(
    "create_task",
    {
      title: "Create Task (write)",
      description:
        "Create a task in Copper attached to a person, company, opportunity, or lead. This WRITES " +
        "to the CRM. With confirm=false (default) it returns a preview and does NOT submit. Set " +
        "confirm=true to actually create it. Refuses to create a task whose title already appears " +
        "on the record (duplicate guard), submits once, and verifies creation.",
      inputSchema: {
        title: z.string().min(1).describe("The task title."),
        dueDate: dateStringSchema.optional().describe("Optional due date (YYYY-MM-DD)."),
        parentType: parentTypeSchema,
        parentId: z
          .string()
          .min(1)
          .describe("Id of the record to attach the task to (as shown in the record URL)."),
        description: z.string().optional().describe("Optional task description / details."),
        confirm: confirmSchema,
      },
    },
    async ({ title, dueDate, parentType, parentId, description, confirm }) =>
      runTool("create_task", async (log) => {
        if (!confirm) {
          const preview: WritePreview = {
            action: "create_task",
            willSubmit: false,
            summary: { title, dueDate, parentType, parentId, description },
            note: "Preview only — nothing was written. Re-run with confirm=true to create this task.",
          };
          return okResult(
            "Preview: this task was NOT created. Set confirm=true to submit.",
            { preview },
            { source: "copper-web-ui", confirmed: false },
          );
        }

        const manager = getBrowserManager();
        return manager.withMutation(async () => {
          const page = await requireAuthenticatedPage(log);
          const task = await new TasksPage(page, log).createTask({
            title,
            dueDate,
            parentType,
            parentId,
            description,
          });
          return okResult(
            "Task created and verified.",
            { task },
            { source: "copper-web-ui", confirmed: true },
          );
        });
      }),
  );
}
