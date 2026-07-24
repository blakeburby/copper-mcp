import { test, expect } from "@playwright/test";
import { BasePage } from "../../pages/basePage.js";
import { recordDetail } from "../../selectors/copperSelectors.js";
import { fixtureUrl } from "./helpers.js";

/**
 * Record-detail extraction against the person fixture. Exercises resolve()'s
 * primary→fallback behavior (getByLabel misses; the label→sibling fallback hits)
 * and textOf().
 */
test.describe("record detail extraction", () => {
  test("reads the record name heading", async ({ page }) => {
    await page.goto(fixtureUrl("person.html"));
    const bp = new BasePage(page);
    const name = await bp.textOf(await bp.resolve(recordDetail.name));
    expect(name).toBe("Jim Halpert");
  });

  test("reads a labeled field via the fallback selector", async ({ page }) => {
    await page.goto(fixtureUrl("person.html"));
    const bp = new BasePage(page);
    // Small timeout so the missing getByLabel primary fails fast to the fallback.
    const loc = await bp.resolve(recordDetail.fieldByLabel("Title"), { timeout: 500 });
    expect(await bp.textOf(loc)).toBe("Sales Rep");

    const company = await bp.resolve(recordDetail.fieldByLabel("Company"), { timeout: 500 });
    expect(await bp.textOf(company)).toBe("Dunder Mifflin");
  });

  test("reads tags and activity feed items", async ({ page }) => {
    await page.goto(fixtureUrl("person.html"));
    const bp = new BasePage(page);

    const tags = await bp.resolve(recordDetail.tags, { timeout: 1_000 });
    expect(await tags.count()).toBe(2);
    expect(await bp.textOf(tags.first())).toBe("Key Contact");

    const activities = await bp.resolve(recordDetail.activityItems, { timeout: 1_000 });
    expect(await activities.count()).toBe(2);
    expect(await bp.textOf(activities.first())).toContain("Q3 paper renewal");
  });

  test("throws SELECTOR_FAILURE with a description when nothing matches", async ({ page }) => {
    await page.goto(fixtureUrl("person.html"));
    const bp = new BasePage(page);
    await expect(
      bp.resolve(recordDetail.fieldByLabel("NonexistentField"), { timeout: 300 }),
    ).rejects.toThrow(/NonexistentField/);
  });
});
