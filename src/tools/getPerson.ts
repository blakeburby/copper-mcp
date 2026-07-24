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
      },
    },
    async ({ personId }) =>
      runTool("get_person", async (log) => {
        const page = await requireAuthenticatedPage(log);
        const person = await new PeoplePage(page, log).get(personId);
        return okResult(`Loaded person "${person.name ?? personId}".`, { person });
      }),
  );
}
