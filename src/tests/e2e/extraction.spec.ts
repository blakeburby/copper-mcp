import { test, expect } from "@playwright/test";
import { BasePage } from "../../pages/basePage.js";
import { fixtureUrl } from "./helpers.js";

/**
 * Row-collection extraction against list fixtures that mirror Copper's real
 * div-based list markup (no <table>, no role="row"). This exercises the shared
 * collectRowLinks() primitive used by search_people / search_companies /
 * search_opportunities — and specifically the primary→fallback selector path,
 * since getByRole("row") cannot match Copper's markup.
 */
test.describe("collectRowLinks", () => {
  test("extracts people rows with name + record URL", async ({ page }) => {
    await page.goto(fixtureUrl("people-list.html"));
    const rows = await new BasePage(page).collectRowLinks(20);
    expect(rows).toHaveLength(6);
    expect(rows[0].name).toBe("Jim Halpert");
    expect(rows[0].href).toContain("#/view/entity/person/1001");
    expect(rows.map((r) => r.name)).toEqual([
      "Jim Halpert",
      "Pam Beesly",
      "Dwight Schrute",
      "Bob Vance",
      "Karen Filippelli",
      "Stanley Hudson",
    ]);
  });

  test("does not mistake the header row for a record", async ({ page }) => {
    await page.goto(fixtureUrl("people-list.html"));
    const rows = await new BasePage(page).collectRowLinks(20);
    expect(rows.map((r) => r.name)).not.toContain("Name");
    // Every collected row must carry a record link.
    for (const r of rows) expect(r.href).toBeTruthy();
  });

  test("respects the limit", async ({ page }) => {
    await page.goto(fixtureUrl("people-list.html"));
    const rows = await new BasePage(page).collectRowLinks(2);
    expect(rows).toHaveLength(2);
  });

  test("extracts company rows", async ({ page }) => {
    await page.goto(fixtureUrl("companies-list.html"));
    const rows = await new BasePage(page).collectRowLinks(20);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.name)).toContain("Dunder Mifflin");
    expect(rows[0].href).toContain("#/view/entity/company/2001");
  });

  test("extracts opportunity rows", async ({ page }) => {
    await page.goto(fixtureUrl("opportunities-list.html"));
    const rows = await new BasePage(page).collectRowLinks(20);
    expect(rows).toHaveLength(4);
    expect(rows[0].href).toContain("#/view/entity/opportunity/3001");
    expect(rows[0].name).toBe("Paper renewal — Dunder Mifflin");
  });

  test("returns [] on an explicit empty state", async ({ page }) => {
    await page.goto(fixtureUrl("empty.html"));
    const rows = await new BasePage(page).collectRowLinks(20);
    expect(rows).toEqual([]);
  });
});
