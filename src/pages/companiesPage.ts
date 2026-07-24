/**
 * Companies page object. Search yields name + record URL/id reliably; other
 * fields are best-effort (UNVERIFIED selectors — validate via README checklist).
 */
import { BasePage } from "./basePage.js";
import { routes } from "../selectors/copperSelectors.js";
import type { CompanySummary } from "../types/records.js";

export class CompaniesPage extends BasePage {
  async search(query: string, limit: number): Promise<CompanySummary[]> {
    return this.read("search_companies", async () => {
      await this.gotoAppRoute(routes.hash.companies);
      await this.fillGlobalSearch(query);
      const rows = await this.collectRowLinks(limit);
      return rows.map((r) => this.toSummary(r.name, r.href));
    });
  }

  private toSummary(name: string | null, href: string | null): CompanySummary {
    return {
      id: this.idFromUrl(href),
      name,
      emailDomain: null,
      phone: null,
      owner: null,
      tags: [],
      recordUrl: href,
    };
  }
}
