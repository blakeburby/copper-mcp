import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireAuthenticatedPage } from "../browser/sessionManager.js";
import { ActivityFeedPage } from "../pages/activityFeedPage.js";
import { okResult } from "../utils/response.js";
import { runTool } from "./_helpers.js";

/**
 * Read a person's activity feed with an explicit, unambiguous feed state.
 *
 * Unlike the `activities` array on `get_person` (best-effort, may be empty for
 * any reason), this tool guarantees that an empty result means the feed really
 * was empty: `feedState: "confirmed_empty"` is only returned after the feed
 * container was positively located. A missing container raises
 * SELECTOR_FAILURE. Consumers that score contacts must use THIS tool, so a
 * scrape failure can never be mistaken for a cold contact.
 */
export function registerGetPersonActivities(server: McpServer): void {
  server.registerTool(
    "get_person_activities",
    {
      title: "Get Person Activities",
      description:
        "Read the activity feed for a person: timestamped events with type, channel, actor, " +
        "and inferred direction (inbound = buyer-initiated, outbound = your outreach). Returns " +
        "feedState 'populated' or 'confirmed_empty' — an empty list is only ever returned when " +
        "the feed was positively confirmed empty, never when a selector failed. Use this rather " +
        "than the best-effort activities array on get_person when the result feeds a score.",
      inputSchema: {
        personId: z
          .string()
          .min(1)
          .describe("The Copper person id (as shown in the record URL)."),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .default(50)
          .describe("Maximum activities to return (1-200, default 50)."),
        sinceIso: z
          .string()
          .datetime()
          .optional()
          .describe("Only return activities at or after this ISO-8601 instant."),
        source: z
          .enum(["auto", "json", "ui"])
          .default("auto")
          .describe(
            "Where to read from. 'auto' (default) uses the fast JSON endpoint and falls back to " +
              "the DOM feed on any failure; 'json' forces the JSON endpoint; 'ui' forces the DOM " +
              "feed. Both return the same shape — 'json'/'ui' exist for A/B correctness checks.",
          ),
      },
    },
    async ({ personId, limit, sinceIso, source }) =>
      runTool("get_person_activities", async (log) => {
        const page = await requireAuthenticatedPage(log);
        const feed = new ActivityFeedPage(page, log);

        // Fast path (JSON) with automatic fallback to the proven DOM reader.
        let result;
        let usedSource: "json" | "ui";
        if (source === "ui") {
          result = await feed.readFeed("person", personId, { limit, sinceIso });
          usedSource = "ui";
        } else if (source === "json") {
          result = await feed.readFeedComposite(personId, { limit, sinceIso });
          usedSource = "json";
        } else {
          try {
            result = await feed.readFeedComposite(personId, { limit, sinceIso });
            usedSource = "json";
          } catch (err) {
            log.warn("JSON activity read failed; falling back to the DOM feed.", {
              error: err instanceof Error ? err.message : String(err),
            });
            result = await feed.readFeed("person", personId, { limit, sinceIso });
            usedSource = "ui";
          }
        }

        const attributed = result.activities.filter((a) => a.direction !== "unknown").length;
        const unattributed = result.activities.length - attributed;

        return okResult(
          result.feedState === "confirmed_empty"
            ? "This person has no activity (feed confirmed empty)."
            : `Found ${result.activities.length} activities.`,
          {
            activities: result.activities,
            feedState: result.feedState,
          },
          {
            recordCount: result.activities.length,
            feedState: result.feedState,
            source: usedSource,
            itemsSeen: result.itemsSeen,
            itemsParsed: result.itemsParsed,
            parserVersion: result.parserVersion,
            parseWarnings: result.parseWarnings.length ? result.parseWarnings : undefined,
            // Surfaced so a consumer can say "N events could not be attributed"
            // rather than silently treating them as absent signal.
            unattributedDirectionCount: unattributed,
          },
        );
      }),
  );
}
