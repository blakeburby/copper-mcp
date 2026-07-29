import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireAuthenticatedPage } from "../browser/sessionManager.js";
import { PeoplePage } from "../pages/peoplePage.js";
import { okResult } from "../utils/response.js";
import { runTool } from "./_helpers.js";

export function registerGetPerson(server: McpServer): void {
  server.registerTool(
    "get_person",
    {
      title: "Get Person",
      description:
        "Open a single person record by its Copper id and return the fields that can be reliably " +
        "extracted (name, title, company, email(s), phone(s), owner, tags), plus recent activities " +
        "and the record URL.",
      inputSchema: {
        personId: z
          .string()
          .min(1)
          .describe("The Copper person id (as shown in the record URL)."),
        source: z
          .enum(["auto", "json", "ui"])
          .default("auto")
          .describe(
            "Where to read from. 'auto' (default) uses the fast JSON endpoint and falls back to " +
              "the DOM record on any failure; 'json'/'ui' force one path (same shape; for A/B checks).",
          ),
      },
    },
    async ({ personId, source }) =>
      runTool("get_person", async (log) => {
        const page = await requireAuthenticatedPage(log);
        const people = new PeoplePage(page, log);

        let person;
        let usedSource: "json" | "ui";
        if (source === "ui") {
          person = await people.get(personId);
          usedSource = "ui";
        } else if (source === "json") {
          person = await people.getJson(personId);
          usedSource = "json";
        } else {
          try {
            person = await people.getJson(personId);
            usedSource = "json";
          } catch (err) {
            log.warn("JSON person read failed; falling back to the DOM record.", {
              error: err instanceof Error ? err.message : String(err),
            });
            person = await people.get(personId);
            usedSource = "ui";
          }
        }
        return okResult(`Loaded person "${person.name ?? personId}".`, { person }, { source: usedSource });
      }),
  );
}
