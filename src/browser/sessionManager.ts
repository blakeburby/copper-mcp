/**
 * Session orchestration: opening Copper, guiding first-time manual login, and
 * reporting session status. Sits on top of BrowserManager + authManager.
 */
import type { Page } from "playwright";
import { loadConfig } from "../config.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { getBrowserManager } from "./browserManager.js";
import { checkAuthenticated, detectAuthState, assertAuthenticated } from "./authManager.js";
import { routes } from "../selectors/copperSelectors.js";

export interface SessionStatus {
  browserRunning: boolean;
  authenticated: boolean;
  /** True when a session appears to have existed but expired (best-effort). */
  sessionExpired: boolean;
  pageUsable: boolean;
  currentUrl: string | null;
}

export interface InitializeResult {
  success: boolean;
  authenticated: boolean;
  currentUrl: string;
  message: string;
}

/** Open Copper in the shared page (does not assert auth). */
export async function openCopper(headlessOverride?: boolean): Promise<Page> {
  const cfg = loadConfig();
  const manager = getBrowserManager();
  const page = await manager.getPage(headlessOverride);
  await page.goto(`${cfg.baseUrl}${routes.appHome}`, {
    waitUntil: "domcontentloaded",
    timeout: cfg.navigationTimeoutMs,
  });
  return page;
}

/**
 * First-time / interactive login. Launches a HEADED browser (forced), navigates
 * to Copper, and polls until the human has completed login — or times out. We
 * never touch credentials, SSO, or MFA ourselves.
 */
export async function initializeSession(
  opts: { maxWaitMs?: number; pollIntervalMs?: number; log?: Logger } = {},
): Promise<InitializeResult> {
  const log = opts.log ?? createLogger();
  const maxWaitMs = opts.maxWaitMs ?? 5 * 60_000; // 5 minutes for manual login.
  const pollIntervalMs = opts.pollIntervalMs ?? 2_000;

  // Force headed so the user can actually sign in.
  const page = await openCopper(true);

  const initial = await detectAuthState(page, log);
  if (initial.authenticated) {
    return {
      success: true,
      authenticated: true,
      currentUrl: initial.currentUrl,
      message: "Already authenticated — the persistent session is still valid.",
    };
  }

  log.info("Waiting for manual login to complete", { maxWaitMs });
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const state = await detectAuthState(page, log);
    if (state.authenticated) {
      log.info("Login detected — session established.");
      return {
        success: true,
        authenticated: true,
        currentUrl: state.currentUrl,
        message:
          "Login complete. The session is persisted in the browser profile and will be reused.",
      };
    }
    await page.waitForTimeout(pollIntervalMs);
  }

  return {
    success: false,
    authenticated: false,
    currentUrl: page.url(),
    message:
      "Timed out waiting for manual login. Re-run initialize_copper_session and complete sign-in (SSO/MFA) in the opened browser window.",
  };
}

/** Non-mutating status probe for get_copper_session_status. */
export async function getSessionStatus(log: Logger = createLogger()): Promise<SessionStatus> {
  const manager = getBrowserManager();

  if (!manager.isRunning()) {
    return {
      browserRunning: false,
      authenticated: false,
      sessionExpired: false,
      pageUsable: false,
      currentUrl: null,
    };
  }

  try {
    const page = await manager.getPage();
    const state = await checkAuthenticated(page, log);
    return {
      browserRunning: true,
      authenticated: state.authenticated,
      // If the browser is up but a login screen shows, treat it as expired.
      sessionExpired: !state.authenticated && state.onLoginScreen,
      pageUsable: !page.isClosed(),
      currentUrl: state.currentUrl,
    };
  } catch (err) {
    log.warn("Session status probe failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      browserRunning: true,
      authenticated: false,
      sessionExpired: false,
      pageUsable: false,
      currentUrl: null,
    };
  }
}

/**
 * Ensure the shared page is on Copper and authenticated; returns the page.
 * Throws AUTHENTICATION_REQUIRED otherwise. Used by every read/write tool.
 */
export async function requireAuthenticatedPage(log: Logger = createLogger()): Promise<Page> {
  const manager = getBrowserManager();
  const page = await manager.getPage();
  await assertAuthenticated(page, log);
  return page;
}
