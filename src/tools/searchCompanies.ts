import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { copperRequest } from "../copperClient.js";
import type { CopperCompany } from "../copperTypes.js";
import { errorResult, textResult } from "./result.js";

export function registerSearchCompanies(server: McpServer): void {
  server.registerTool(
    "search_companies",
    {
      title: "Search Companies",
      description:
        "Find companies (accounts) in Copper by name. Use this to resolve a company before " +
        "filtering opportunities or logging an activity against it. Returns a list of matches, " +
        "each with id, name, domain, and primary phone. If no name is given it returns the " +
        "most recent companies.",
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe("Full or partial company name to search for, e.g. 'Dunder Mifflin'."),
        page_size: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Maximum number of companies to return (default 10)."),
      },
    },
    async ({ name, page_size }) => {
      try {
        const body: Record<string, unknown> = { page_size: page_size ?? 10 };
        if (name) body.name = name;

        const companies = await copperRequest<CopperCompany[]>(
          "POST",
          "/companies/search",
          body,
        );

        if (!companies.length) return textResult("No companies matched that search.");

        const rows = companies.map((c) => ({
          id: c.id,
          name: c.name,
          domain: c.email_domain ?? null,
          phone: c.phone_numbers?.[0]?.number ?? null,
        }));
        return textResult(rows);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
