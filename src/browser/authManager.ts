/**
 * Authentication state detection.
 *
 * We never handle credentials ourselves — login (password / Google SSO / MFA) is
 * done by the human in a headed browser. This module only *observes* whether the
 * persistent session is currently authenticated, using URL signals plus a DOM
 * signal for the authenticated app shell.
 */
import type { Page } from "playwright";
import { loadConfig } from "../config.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { auth as authSelectors, routes } from "../selectors/copperSelectors.js";
import { errors } from "../types/errors.js";

export interface AuthState {
  authenticated: boolean;
  currentUrl: string;
  /** True when we can see a login screen (as opposed to just "not sure"). */
  onLoginScreen: boolean;
}

/** URL looks like a login / SSO screen. */
function urlLooksLikeLogin(url: string): boolean {
  return routes.loginSignals.some((re) => re.test(url));
}

/**
 * Inspect the current page and decide whether we are authenticated. This does not
 * navigate — call after the page is already on a Copper URL.
 */
export async function detectAuthState(
  page: Page,
  log: Logger = createLogger(),
): Promise<AuthState> {
  const currentUrl = page.url();

  if (urlLooksLikeLogin(currentUrl)) {
    log.debug("URL matches a login signal", { currentUrl });
    return { authenticated: false, currentUrl, onLoginScreen: true };
  }

  // Strong positive URL signal: the account-scoped app shell URL.
  if (routes.appShellUrl.test(currentUrl)) {
    log.debug("URL matches the authenticated app-shell pattern", { currentUrl });
    return { authenticated: true, currentUrl, onLoginScreen: false };
  }

  // Positive DOM signal: the authenticated app shell (search box / nav links).
  const shell = authSelectors.appShell;
  const primaryVisible = await shell
    .primary(page)
    .first()
    .isVisible()
    .catch(() => false);
  const fallbackVisible = primaryVisible
    ? true
    : await shell
        .fallback(page)
        .first()
        .isVisible()
        .catch(() => false);

  if (primaryVisible || fallbackVisible) {
    return { authenticated: true, currentUrl, onLoginScreen: false };
  }

  // Negative signal: a login form/button is visible.
  const loginVisible = await authSelectors.loginForm
    .primary(page)
    .first()
    .isVisible()
    .catch(() => false);

  return {
    authenticated: false,
    currentUrl,
    onLoginScreen: loginVisible || urlLooksLikeLogin(currentUrl),
  };
}

/**
 * Navigate to the app home and report auth state. Used by tools before doing work.
 */
export async function checkAuthenticated(
  page: Page,
  log: Logger = createLogger(),
): Promise<AuthState> {
  const cfg = loadConfig();
  try {
    await page.goto(`${cfg.baseUrl}${routes.appHome}`, {
      waitUntil: "domcontentloaded",
      timeout: cfg.navigationTimeoutMs,
    });
  } catch (err) {
    log.warn("Navigation during auth check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return detectAuthState(page, log);
}

/** Throw AUTHENTICATION_REQUIRED unless the session is authenticated. */
export async function assertAuthenticated(
  page: Page,
  log: Logger = createLogger(),
): Promise<AuthState> {
  const state = await checkAuthenticated(page, log);
  if (!state.authenticated) {
    throw errors.auth(
      state.onLoginScreen
        ? "A Copper login screen is showing. Run initialize_copper_session and sign in."
        : "Could not confirm an authenticated Copper session (it may have expired).",
    );
  }
  return state;
}
