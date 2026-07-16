import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { copperRequest } from "../copperClient.js";
import type { CopperPerson } from "../copperTypes.js";
import { errorResult, textResult } from "./result.js";

export function registerSearchPeople(server: McpServer): void {
  server.registerTool(
    "search_people",
    {
      title: "Search People",
      description:
        "Find people (contacts) in Copper by name and/or email address. Use this to look " +
        "up a contact before logging an activity or creating a task against them. Returns a " +
        "list of matches, each with id, name, primary email, company_name, and title. If no " +
        "filters are given it returns the most recent people.",
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe("Full or partial name to search for, e.g. 'Jim Halpert'."),
        email: z
          .string()
          .optional()
          .describe("Exact email address to search for."),
        page_size: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Maximum number of people to return (default 10)."),
      },
    },
    async ({ name, email, page_size }) => {
      try {
        const body: Record<string, unknown> = { page_size: page_size ?? 10 };
        if (name) body.name = name;
        if (email) body.emails = [email];

        const people = await copperRequest<CopperPerson[]>(
          "POST",
          "/people/search",
          body,
        );

        if (!people.length) return textResult("No people matched that search.");

        const rows = people.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.emails?.[0]?.email ?? null,
          company_name: p.company_name ?? null,
          title: p.title ?? null,
        }));
        return textResult(rows);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
