/**
 * Failure diagnostics. On selector / navigation / unexpected-layout failures we
 * capture a timestamped screenshot (and optionally a sanitized HTML snapshot),
 * plus the URL and page title, so problems can be triaged without guessing.
 *
 * We deliberately DO NOT write cookies, tokens, storage state, or form field
 * values into these artifacts.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { loadConfig } from "../config.js";
import { rootLogger, type Logger } from "../utils/logger.js";

export interface DiagnosticsResult {
  screenshotPath?: string;
  htmlPath?: string;
  consolePath?: string;
  url?: string;
  title?: string;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeLabel(label: string): string {
  return label.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60);
}

/** Strip obviously-sensitive content out of an HTML snapshot. */
export function sanitizeHtml(html: string): string {
  return html
    // Blank out any input/textarea values.
    .replace(/(<(?:input|textarea)\b[^>]*\bvalue=)(["']).*?\2/gi, "$1$2[REDACTED]$2")
    // Drop password fields entirely.
    .replace(/<input\b[^>]*type=(["'])password\1[^>]*>/gi, "<input type=password redacted>")
    // Empty out inline scripts (may embed session data / tokens).
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script>[REDACTED]</script>");
}

/**
 * Capture diagnostics for the current page state. Never throws — diagnostics are
 * best-effort and must not mask the original error.
 */
export async function captureDiagnostics(
  page: Page | undefined,
  label: string,
  opts: { includeHtml?: boolean; logger?: Logger; consoleMessages?: string[] } = {},
): Promise<DiagnosticsResult> {
  const log = opts.logger ?? rootLogger;
  const result: DiagnosticsResult = {};
  if (!page || page.isClosed()) return result;

  try {
    const cfg = loadConfig();
    await mkdir(cfg.screenshotDir, { recursive: true });
    const base = `${timestamp()}_${safeLabel(label)}`;

    try {
      result.url = page.url();
    } catch {
      /* ignore */
    }
    try {
      result.title = await page.title();
    } catch {
      /* ignore */
    }

    const screenshotPath = join(cfg.screenshotDir, `${base}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshotPath = screenshotPath;

    if (opts.includeHtml) {
      const htmlPath = join(cfg.screenshotDir, `${base}.html`);
      const html = await page.content();
      await writeFile(htmlPath, sanitizeHtml(html), "utf8");
      result.htmlPath = htmlPath;
    }

    // The page's OWN errors are usually the fastest route to a diagnosis: an
    // exception during app boot explains a blank screen far better than a
    // screenshot of the blank screen does.
    if (opts.consoleMessages?.length) {
      const consolePath = join(cfg.screenshotDir, `${base}.console.log`);
      await writeFile(consolePath, opts.consoleMessages.join("\n"), "utf8");
      result.consolePath = consolePath;
    }

    log.info("Captured diagnostics", {
      screenshotPath: result.screenshotPath,
      htmlPath: result.htmlPath,
      url: result.url,
    });
  } catch (err) {
    log.warn("Failed to capture diagnostics (ignored).", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}
