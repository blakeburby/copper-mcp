import { test, expect } from "@playwright/test";
import { detectAuthState } from "../../browser/authManager.js";
import { fixtureUrl } from "./helpers.js";

/**
 * Authenticated-session detection against local fixtures (no live Copper).
 */
test.describe("detectAuthState", () => {
  test("recognizes the authenticated app shell", async ({ page }) => {
    await page.goto(fixtureUrl("authenticated.html"));
    const state = await detectAuthState(page);
    expect(state.authenticated).toBe(true);
    expect(state.onLoginScreen).toBe(false);
  });

  test("recognizes a login screen as unauthenticated", async ({ page }) => {
    await page.goto(fixtureUrl("login.html"));
    const state = await detectAuthState(page);
    expect(state.authenticated).toBe(false);
    expect(state.onLoginScreen).toBe(true);
  });
});
