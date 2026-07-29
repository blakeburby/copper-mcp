import { describe, it, expect } from "vitest";
import type { Page } from "playwright";
import { BasePage } from "../../pages/basePage.js";

/**
 * The persistent context reuses ONE page for the whole session, but a BasePage is
 * constructed per tool call. Regression guard: the page's event listeners must be
 * attached exactly once per page, no matter how many BasePages wrap it — otherwise
 * a long sync accumulates thousands of listeners on the live page.
 */
describe("BasePage page-listener attachment", () => {
  function fakePage(counts: Record<string, number>): Page {
    return {
      on: (event: string) => {
        counts[event] = (counts[event] ?? 0) + 1;
      },
    } as unknown as Page;
  }

  it("attaches each listener once across many BasePage instances on the same page", () => {
    const counts: Record<string, number> = {};
    const page = fakePage(counts);
    for (let i = 0; i < 5; i++) new BasePage(page);
    expect(counts.console).toBe(1);
    expect(counts.pageerror).toBe(1);
    expect(counts.requestfailed).toBe(1);
    expect(counts.dialog).toBe(1);
  });

  it("attaches listeners for a genuinely different page", () => {
    const a: Record<string, number> = {};
    const b: Record<string, number> = {};
    new BasePage(fakePage(a));
    new BasePage(fakePage(b));
    expect(a.console).toBe(1);
    expect(b.console).toBe(1);
  });
});
