import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression guard for a bug that made the login flow unusable.
 *
 * `initializeSession` called `openCopper(true)` against a parameter named
 * `headlessOverride`, with a comment claiming it forced a HEADED browser. It did
 * the opposite: Chromium launched headless and then waited five minutes for a
 * human to sign into a window that was never drawn.
 *
 * This is the one flow whose entire purpose is human interaction, so it must
 * always request a visible browser regardless of COPPER_HEADLESS.
 */
const getPage = vi.fn(async () => ({
  goto: vi.fn(async () => undefined),
  url: () => "https://app.copper.com/users/sign_in",
  waitForTimeout: vi.fn(async () => undefined),
  isClosed: () => false,
}));

vi.mock("../../browser/browserManager.js", () => ({
  getBrowserManager: () => ({ getPage, isRunning: () => true }),
}));

vi.mock("../../browser/authManager.js", () => ({
  detectAuthState: vi.fn(async () => ({
    authenticated: true,
    currentUrl: "https://app.copper.com/companies/1/app#/feed",
    onLoginScreen: false,
  })),
  checkAuthenticated: vi.fn(),
  assertAuthenticated: vi.fn(),
}));

describe("initializeSession browser visibility", () => {
  beforeEach(() => getPage.mockClear());

  it("requests a VISIBLE browser — headless:false, never true", async () => {
    const { initializeSession } = await import("../../browser/sessionManager.js");
    await initializeSession({ maxWaitMs: 10, pollIntervalMs: 1 });

    expect(getPage).toHaveBeenCalled();
    const headlessArg = getPage.mock.calls[0]?.[0];
    // The bug passed `true` here, which silently made login impossible.
    expect(headlessArg).toBe(false);
    expect(headlessArg).not.toBe(true);
  });
});
