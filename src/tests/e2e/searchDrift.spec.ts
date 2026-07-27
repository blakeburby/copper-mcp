import { test, expect } from "@playwright/test";
import { BasePage } from "../../pages/basePage.js";
import { fixtureUrl } from "./helpers.js";

/**
 * Regression guard for the selector-drift hazard on a full-rights login.
 *
 * The fixture contains ONE input matching the loose /search/i fallback — but it
 * is an inline-editable record field ("Add Search Consultant Title"). On a
 * production client account, typing a search query into it would save that
 * query onto a real CRM record. safeFill must refuse.
 */
test.describe("search selector drift", () => {
  test("fillGlobalSearch refuses to type into a drifted record field", async ({ page }) => {
    await page.goto(fixtureUrl("search-drift.html"));
    const bp = new BasePage(page);

    await expect(bp.fillGlobalSearch("Jim Halpert")).rejects.toThrow(/global search input/i);

    // The decisive assertion: NOTHING was typed into the trap field.
    await expect(page.locator("#trap")).toHaveValue("");
  });

  test("the trap input genuinely matches the loose fallback (fixture is honest)", async ({ page }) => {
    // If the fixture stops matching /search/i, the test above passes vacuously.
    await page.goto(fixtureUrl("search-drift.html"));
    await expect(page.getByPlaceholder(/search/i)).toHaveCount(1);
  });

  test("safeFill refuses any Add-* record field even with a permissive expectation", async ({ page }) => {
    await page.goto(fixtureUrl("search-drift.html"));
    const bp = new BasePage(page);
    // Expectation matches the trap's placeholder — but the record-field gate
    // must still refuse, because the expectation itself is not an Add-* field.
    await expect(
      bp.safeFill(
        page.locator("#trap"),
        { placeholder: /search consultant/i },
        "should never land",
        "drift probe",
      ),
    ).rejects.toThrow(/record-field signature/i);
    await expect(page.locator("#trap")).toHaveValue("");
  });
});
