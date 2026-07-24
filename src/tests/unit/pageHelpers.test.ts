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

  it("idFromUrl extracts the numeric record id", () => {
    expect(page.pubId("https://app.copper.com/people/1234567")).toBe("1234567");
    expect(page.pubId("/companies/42?tab=activity")).toBe("42");
    expect(page.pubId("https://app.copper.com/dashboard")).toBeNull();
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
    sel.recordDetail.name,
    sel.recordDetail.fieldByLabel("Email"),
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

  it("fieldByLabel builds a labeled entry referencing the label", () => {
    const entry = sel.recordDetail.fieldByLabel("Owner");
    expect(entry.description).toContain("Owner");
  });
});
