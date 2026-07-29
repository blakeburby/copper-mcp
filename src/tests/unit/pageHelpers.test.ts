import { describe, it, expect } from "vitest";
import type { Page } from "playwright";
import { BasePage } from "../../pages/basePage.js";
import * as sel from "../../selectors/copperSelectors.js";

/** A stub Page that only supports the `.on()` the BasePage constructor calls. */
const stubPage = { on: () => undefined } as unknown as Page;

class TestPage extends BasePage {
  pubId(url: string | null) {
    return this.idFromUrl(url);
  }
  pubAbs(href: string | null) {
    return this.absolutize(href);
  }
}

describe("BasePage URL helpers", () => {
  const page = new TestPage(stubPage);

  it("idFromUrl handles Copper's real record URL forms", () => {
    // VERIFIED live 2026-07-24: records are addressed via a fullProfile query
    // param on the list route, or the short #/contact/<id> form.
    expect(page.pubId("#/browse/list/people/default?fullProfile=people-184433443")).toBe("184433443");
    expect(page.pubId("#/browse/list/companies/default?fullProfile=companies-77183427")).toBe("77183427");
    expect(page.pubId("https://app.copper.com/companies/616931/app/#/contact/184433443")).toBe("184433443");
    expect(page.pubId("https://app.copper.com/companies/616931/app#/feed")).toBe("616931");
    expect(page.pubId(null)).toBeNull();
  });

  it("absolutize resolves relative hrefs against the base URL", () => {
    expect(page.pubAbs("/people/1")).toBe("https://app.copper.com/people/1");
    expect(page.pubAbs("people/1")).toBe("https://app.copper.com/people/1");
    expect(page.pubAbs("https://x.copper.com/y")).toBe("https://x.copper.com/y");
    expect(page.pubAbs(null)).toBeNull();
  });
});

describe("selector entries expose primary + fallback + description", () => {
  const entries: sel.SelectorEntry[] = [
    sel.globalSearch.input,
    sel.list.rows,
    sel.list.rowLink,
    sel.auth.appShell,
    sel.activityComposer.submitButton,
    sel.taskComposer.titleInput,
    sel.personComposer.firstName,
    sel.createModal.saveButton,
    sel.recordDetail.name,
    sel.recordDetail.fieldByPlaceholder("Add Email"),
  ];

  it("every entry has a description and two distinct resolvers", () => {
    for (const e of entries) {
      expect(typeof e.description).toBe("string");
      expect(e.description.length).toBeGreaterThan(0);
      expect(typeof e.primary).toBe("function");
      expect(typeof e.fallback).toBe("function");
      expect("verified" in e).toBe(true);
    }
  });

  it("fieldByPlaceholder builds an entry referencing the placeholder", () => {
    const entry = sel.recordDetail.fieldByPlaceholder("Add Owner");
    expect(entry.description).toContain("Add Owner");
  });
});
