import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { copperRequest } from "../copperClient.js";
import { errorResult, textResult } from "./result.js";

/**
 * The ONE write tool in this server. Everything else is read-only by design —
 * a deliberately narrow blast radius. Logging a note/call cannot delete or
 * overwrite existing CRM data; it only appends an activity to a record.
 *
 * Copper models an activity type as { category, id }. The default "Note" is
 * category "user", id 0 — the only type callers usually need. Only "user"
 * activities can be created via the API.
 * Docs: https://developer.copper.com/activities/create-a-new-activity.html
 */
export function registerLogActivity(server: McpServer): void {
  server.registerTool(
    "log_activity",
    {
      title: "Log Activity (write)",
      description:
        "Log a note or call activity onto a person, company, opportunity, or lead in Copper. " +
        "This is the only tool that writes to the CRM — it APPENDS an activity (it never edits " +
        "or deletes existing data). Use it to record a call summary or leave a reminder note on " +
        "a record. Defaults to a 'Note' activity. Returns the created activity.",
      inputSchema: {
        parent: z
          .object({
            id: z.number().int().describe("The id of the record to log against."),
            type: z
              .enum(["person", "company", "opportunity", "lead"])
              .describe("The kind of record the activity is attached to."),
          })
          .describe("The CRM record this activity is logged on."),
        details: z
          .string()
          .describe("The note / activity text to record."),
        activity_type_id: z
          .number()
          .int()
          .optional()
          .describe(
            "Copper activity type id. Defaults to 0 (Note). Other user-defined types can be " +
              "found via the Copper UI; leave unset to log a plain note.",
          ),
      },
    },
    async ({ parent, details, activity_type_id }) => {
      try {
        const body = {
          parent,
          type: { category: "user", id: activity_type_id ?? 0 },
          details,
        };
        const activity = await copperRequest("POST", "/activities", body);
        return textResult(activity);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
