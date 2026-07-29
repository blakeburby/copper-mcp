import { test, expect } from "@playwright/test";
import { BasePage } from "../../pages/basePage.js";
import { fixtureUrl } from "./helpers.js";

/**
 * collectAllRowLinks must page through a lazy/virtualized list — the difference
 * between enumerating a 2-contact dev account and a real account with thousands.
 * The fixture reveals 50 records 10-at-a-time on scroll; a single DOM read would
 * see only the first 10.
 */
test.describe("collectAllRowLinks (roster enumeration)", () => {
  test("scrolls through the whole list and reports complete", async ({ page }) => {
    await page.goto(fixtureUrl("people-list-virtualized.html"));
    const { rows, complete } = await new BasePage(page).collectAllRowLinks(5_000);

    expect(complete).toBe(true);
    expect(rows).toHaveLength(50);
    // Deduped by href across every scroll round.
    expect(new Set(rows.map((r) => r.href)).size).toBe(50);
    expect(rows[0].name).toBe("Contact 01");
    expect(rows[49].name).toBe("Contact 50");
    expect(rows[0].href).toContain("fullProfile=people-100000");
  });

  test("a single DOM read would have truncated to the first screen", async ({ page }) => {
    await page.goto(fixtureUrl("people-list-virtualized.html"));
    // collectRowLinks does NOT scroll — it sees only the initial batch. This is
    // the exact bug collectAllRowLinks fixes; pinning it keeps the contrast honest.
    const single = await new BasePage(page).collectRowLinks(5_000);
    expect(single.length).toBe(10);
  });

  test("reports TRUNCATED (complete=false) when the cap is hit", async ({ page }) => {
    await page.goto(fixtureUrl("people-list-virtualized.html"));
    const { rows, complete } = await new BasePage(page).collectAllRowLinks(25);
    expect(complete).toBe(false);
    expect(rows.length).toBe(25);
    expect(rows[0].name).toBe("Contact 01");
  });

  test("an empty list is complete with zero rows (not a selector failure)", async ({ page }) => {
    await page.goto(fixtureUrl("empty.html"));
    const { rows, complete } = await new BasePage(page).collectAllRowLinks(5_000);
    expect(rows).toEqual([]);
    expect(complete).toBe(true);
  });
});
