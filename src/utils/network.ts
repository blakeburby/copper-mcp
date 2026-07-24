/**
 * Optional network-response capture.
 *
 * The integration remains browser-session-based: Playwright owns authentication
 * and drives the UI. But when the authenticated session fires an XHR/fetch whose
 * JSON is far more structured than the rendered DOM, we may *observe* that
 * response to improve extraction.
 *
 * RULES (see README "Network-response use"):
 *   - This is a best-effort enhancement, never the primary integration.
 *   - Callers MUST provide a DOM fallback for when capture misses.
 *   - We do not construct our own API client, and we hardcode no endpoint tokens.
 *   - Internal endpoints are assumed unstable and may break without notice.
 */
import type { Page, Response } from "playwright";
import { createLogger, type Logger } from "./logger.js";

/**
 * Run `trigger` (e.g. a click / navigation) and try to capture the JSON body of
 * the first response whose URL matches `urlPattern`. Returns null on any miss;
 * callers fall back to DOM scraping.
 */
export async function captureJsonResponse<T = unknown>(
  page: Page,
  urlPattern: RegExp,
  trigger: () => Promise<void>,
  opts: { timeoutMs?: number; log?: Logger } = {},
): Promise<T | null> {
  const log = opts.log ?? createLogger();
  const timeout = opts.timeoutMs ?? 8_000;

  const waitForResponse = page
    .waitForResponse(
      (resp: Response) =>
        urlPattern.test(resp.url()) && resp.request().method() !== "OPTIONS",
      { timeout },
    )
    .catch(() => null);

  try {
    await trigger();
  } catch (err) {
    log.debug("Network-capture trigger threw (continuing to await response)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const resp = await waitForResponse;
  if (!resp) {
    log.debug("No matching network response captured; DOM fallback will be used.", {
      pattern: urlPattern.toString(),
    });
    return null;
  }

  try {
    const json = (await resp.json()) as T;
    log.debug("Captured structured JSON response", { url: resp.url() });
    return json;
  } catch {
    log.debug("Matching response was not JSON; DOM fallback will be used.");
    return null;
  }
}
