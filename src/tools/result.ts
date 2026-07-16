/** Shared helpers for turning tool logic into MCP `CallToolResult`s. */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CopperApiError } from "../copperClient.js";

/** Wrap data (object/array → pretty JSON, or a plain string) as a text result. */
export function textResult(data: unknown): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Turn any thrown error into a clean, agent-readable error result. */
export function errorResult(err: unknown): CallToolResult {
  const message =
    err instanceof CopperApiError
      ? err.message
      : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  return { content: [{ type: "text", text: `⚠️ ${message}` }], isError: true };
}
