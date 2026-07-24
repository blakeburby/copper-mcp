import { test, expect } from "@playwright/test";
import { BasePage } from "../../pages/basePage.js";
import { recordDetail } from "../../selectors/copperSelectors.js";
import { fixtureUrl } from "./helpers.js";

/**
 * Record-detail extraction against a fixture that mirrors Copper's real
 * "full profile" panel: values live in inline-editable <input> VALUES, so this
 * exercises BasePage.valueOf() rather than text extraction.
 */
test.describe("record detail extraction", () => {
  test("reads the record name from the Add Name input value", async ({ page }) => {
    await page.goto(fixtureUrl("person.html"));
    const bp = new BasePage(page);
    const loc = await bp.resolve(recordDetail.name, { timeout: 1_000 });
    expect(await bp.valueOf(loc)).toBe("Jim Halpert");
  });

  test("textOf returns nothing for input-backed fields (why valueOf exists)", async ({ page }) => {
    await page.goto(fixtureUrl("person.html"));
    const bp = new BasePage(page);
    const loc = await bp.resolve(recordDetail.fieldByPlaceholder("Add Title"), { timeout: 1_000 });
    // Regression guard: reading these with innerText silently yields empty,
    // which is exactly the bug live capture uncovered.
    expect(await bp.textOf(loc)).toBeNull();
    expect(await bp.valueOf(loc)).toBe("Sales Representative");
  });

  test("reads fields by their Copper placeholders", async ({ page }) => {
    await page.goto(fixtureUrl("person.html"));
    const bp = new BasePage(page);
    const read = async (ph: string) =>
      bp.valueOf(await bp.resolve(recordDetail.fieldByPlaceholder(ph), { timeout: 1_000 }));

    expect(await read("Add Company")).toBe("Dunder Mifflin");
    expect(await read("Add Owner")).toBe("Blake Burby");
    expect(await read("Add Email")).toBe("jim.halpert@dundermifflin.example");
    expect(await read("Add Phone")).toBe("555-0101");
  });

  test("throws SELECTOR_FAILURE with a description when nothing matches", async ({ page }) => {
    await page.goto(fixtureUrl("person.html"));
    const bp = new BasePage(page);
    await expect(
      bp.resolve(recordDetail.fieldByPlaceholder("Add Nonexistent"), { timeout: 300 }),
    ).rejects.toThrow(/Add Nonexistent/);
  });
});
