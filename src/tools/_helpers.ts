/**
 * Shared tool plumbing: consistent logging + error-to-envelope conversion so
 * every tool returns the canonical structured response and never leaks a raw
 * stack trace or HTML.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { errorToResult } from "../utils/response.js";

/**
 * Wrap a tool handler: creates an operation-scoped logger, runs the handler, and
 * converts any thrown value into a structured error CallToolResult.
 */
export async function runTool(
  name: string,
  handler: (log: Logger) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const log = createLogger();
  log.info(`tool ${name} invoked`);
  try {
    const result = await handler(log);
    log.info(`tool ${name} completed`);
    return result;
  } catch (err) {
    log.error(`tool ${name} failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return errorToResult(err);
  }
}
