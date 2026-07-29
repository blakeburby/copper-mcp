import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBrowserManager } from "../browser/browserManager.js";
import { requireAuthenticatedPage } from "../browser/sessionManager.js";
import { ActivitiesPage } from "../pages/activitiesPage.js";
import { parentTypeSchema, confirmSchema } from "../schemas/common.js";
import { okResult } from "../utils/response.js";
import type { WritePreview } from "../types/records.js";
import { runTool } from "./_helpers.js";

/**
 * WRITE TOOL. Appends a note/activity to a record via the web UI. Guarded by a
 * confirm gate (preview unless confirm=true) and the process-wide mutation lock.
 * Submits once and verifies; never blindly re-submits.
 */
export function registerLogActivity(server: McpServer): void {
  server.registerTool(
    "log_activity",
    {
      title: "Log Activity (write)",
      description:
        "Log a note or call activity onto a person, company, opportunity, or lead in Copper. This " +
        "WRITES to the CRM (it appends an activity; it never edits or deletes). With confirm=false " +
        "(default) it returns a preview and does NOT submit. Set confirm=true to actually log it. " +
        "After submitting it verifies the activity appears and returns its details.",
      inputSchema: {
        parentType: parentTypeSchema,
        parentId: z
          .string()
          .min(1)
          .describe("Id of the record to log against (as shown in the record URL)."),
        activityType: z
          .string()
          .default("Note")
          .describe("Activity type label, e.g. 'Note' or 'Call'. Defaults to 'Note'."),
        details: z.string().min(1).describe("The note / activity text to record."),
        confirm: confirmSchema,
      },
    },
    async ({ parentType, parentId, activityType, details, confirm }) =>
      runTool("log_activity", async (log) => {
        if (!confirm) {
          const preview: WritePreview = {
            action: "log_activity",
            willSubmit: false,
            summary: { parentType, parentId, activityType, details },
            note: "Preview only — nothing was written. Re-run with confirm=true to log this activity.",
          };
          return okResult(
            "Preview: this activity was NOT logged. Set confirm=true to submit.",
            { preview },
            { source: "copper-web-ui", confirmed: false },
          );
        }

        const manager = getBrowserManager();
        return manager.withMutation(async () => {
          const page = await requireAuthenticatedPage(log);
          const activity = await new ActivitiesPage(page, log).logActivity({
            parentType,
            parentId,
            activityType,
            details,
          });
          return okResult(
            "Activity logged and verified.",
            { activity },
            { source: "copper-web-ui", confirmed: true },
          );
        });
      }),
  );
}
