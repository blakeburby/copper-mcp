import { test, expect } from "@playwright/test";
import { BasePage } from "../../pages/basePage.js";
import { fixtureUrl } from "./helpers.js";

/**
 * Row-collection extraction against list fixtures. Exercises the shared
 * collectRowLinks() primitive used by search_people / search_companies /
 * search_opportunities.
 */
test.describe("collectRowLinks", () => {
  test("extracts people rows with name + record URL", async ({ page }) => {
    await page.goto(fixtureUrl("people-list.html"));
    const rows = await new BasePage(page).collectRowLinks(20);
    expect(rows).toHaveLength(3);
    expect(rows[0].name).toBe("Jim Halpert");
    expect(rows[0].href).toContain("/people/1001");
  });

  test("respects the limit", async ({ page }) => {
    await page.goto(fixtureUrl("people-list.html"));
    const rows = await new BasePage(page).collectRowLinks(2);
    expect(rows).toHaveLength(2);
  });

  test("extracts company rows", async ({ page }) => {
    await page.goto(fixtureUrl("companies-list.html"));
    const rows = await new BasePage(page).collectRowLinks(20);
    expect(rows.map((r) => r.name)).toContain("Dunder Mifflin");
  });

  test("extracts opportunity rows", async ({ page }) => {
    await page.goto(fixtureUrl("opportunities-list.html"));
    const rows = await new BasePage(page).collectRowLinks(20);
    expect(rows[0].href).toContain("/opportunities/3001");
  });

  test("returns [] on an explicit empty state", async ({ page }) => {
    await page.goto(fixtureUrl("empty.html"));
    const rows = await new BasePage(page).collectRowLinks(20);
    expect(rows).toEqual([]);
  });
});
