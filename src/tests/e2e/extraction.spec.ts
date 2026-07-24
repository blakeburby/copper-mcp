import { test, expect } from "@playwright/test";
import { BasePage } from "../../pages/basePage.js";
import { fixtureUrl } from "./helpers.js";

/**
 * Row extraction against fixtures that mirror Copper's real list table
 * (tbody.ListViewTableBody > tr.et-tr, a.fullProfileLink, span.AvatarPill_text).
 */
test.describe("collectRowLinks", () => {
  test("extracts people rows with clean names and record URLs", async ({ page }) => {
    await page.goto(fixtureUrl("people-list.html"));
    const rows = await new BasePage(page).collectRowLinks(20);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toEqual(["Jim Halpert", "Pam Beesly", "Dwight Schrute"]);
    expect(rows[0].href).toContain("fullProfile=people-184433443");
  });

  test("skips the header row", async ({ page }) => {
    await page.goto(fixtureUrl("people-list.html"));
    const rows = await new BasePage(page).collectRowLinks(20);
    expect(rows.map((r) => r.name)).not.toContain("Person");
    for (const r of rows) expect(r.href).toBeTruthy();
  });

  test("respects the limit", async ({ page }) => {
    await page.goto(fixtureUrl("people-list.html"));
    expect(await new BasePage(page).collectRowLinks(2)).toHaveLength(2);
  });

  test("extracts company rows", async ({ page }) => {
    await page.goto(fixtureUrl("companies-list.html"));
    const rows = await new BasePage(page).collectRowLinks(20);
    expect(rows.map((r) => r.name)).toContain("Dunder Mifflin");
    expect(rows[0].href).toContain("fullProfile=companies-77183427");
  });

  test("extracts opportunity rows", async ({ page }) => {
    await page.goto(fixtureUrl("opportunities-list.html"));
    const rows = await new BasePage(page).collectRowLinks(20);
    expect(rows[0].name).toBe("Paper renewal — Dunder Mifflin");
    expect(rows[0].href).toContain("fullProfile=opportunities-99120001");
  });

  test("returns [] on an explicit empty state", async ({ page }) => {
    await page.goto(fixtureUrl("empty.html"));
    expect(await new BasePage(page).collectRowLinks(20)).toEqual([]);
  });
});
