/**
 * People (contacts) page object.
 *
 * NOTE ON FIDELITY: the field-level selectors are UNVERIFIED against the live
 * Copper UI (see copperSelectors.ts). Search reliably yields a record name + URL
 * (and hence id); richer fields are best-effort and return null when they can't
 * be extracted confidently. Validate with the README manual checklist.
 */
import { BasePage } from "./basePage.js";
import { routes, recordDetail } from "../selectors/copperSelectors.js";
// Record-view routes (routes.recordView.*) are UNVERIFIED — see copperSelectors.ts.
import type { PersonSummary, PersonDetail, ActivitySummary } from "../types/records.js";
import { errors } from "../types/errors.js";

export class PeoplePage extends BasePage {
  /** Search people by free text; returns lightweight summaries. */
  async search(query: string, limit: number): Promise<PersonSummary[]> {
    return this.read("search_people", async () => {
      await this.gotoAppRoute(routes.hash.people);
      await this.fillGlobalSearch(query);
      const rows = await this.collectRowLinks(limit);
      return rows.map((r) => this.toSummary(r.name, r.href));
    });
  }

  /** Open a single person record and extract detail fields. */
  async get(personId: string): Promise<PersonDetail> {
    return this.read("get_person", async () => {
      await this.gotoAppRoute(routes.recordView.person(encodeURIComponent(personId)));
      await this.waitForSettled();

      const nameLoc = await this.tryResolve(recordDetail.name);
      const name = await this.textOf(nameLoc);
      if (!name) {
        throw errors.notFound(`Person "${personId}"`, "No record heading was found at the record URL.");
      }

      const [title, companyName, email, phone, owner] = await Promise.all([
        this.field("Title"),
        this.field("Company"),
        this.field("Email"),
        this.field("Phone"),
        this.field("Owner"),
      ]);

      const tags = await this.tags();
      const activities = await this.activities();
      const recordUrl = this.raw.url();

      const summary: PersonSummary = {
        id: personId ?? this.idFromUrl(recordUrl),
        name,
        title,
        companyName,
        email,
        phone,
        owner,
        tags,
        recordUrl,
      };
      return {
        ...summary,
        emails: email ? [email] : [],
        phones: phone ? [phone] : [],
        activities,
      };
    });
  }

  private toSummary(name: string | null, href: string | null): PersonSummary {
    return {
      id: this.idFromUrl(href),
      name,
      title: null,
      companyName: null,
      email: null,
      phone: null,
      owner: null,
      tags: [],
      recordUrl: href,
    };
  }

  private async field(label: string): Promise<string | null> {
    const loc = await this.tryResolve(recordDetail.fieldByLabel(label), { timeout: 1_500 });
    return this.textOf(loc);
  }

  private async tags(): Promise<string[]> {
    const loc = await this.tryResolve(recordDetail.tags, { timeout: 1_500 });
    if (!loc) return [];
    const count = await loc.count().catch(() => 0);
    const out: string[] = [];
    for (let i = 0; i < Math.min(count, 25); i++) {
      const t = await this.textOf(loc.nth(i));
      if (t) out.push(t);
    }
    return out;
  }

  private async activities(): Promise<ActivitySummary[]> {
    const loc = await this.tryResolve(recordDetail.activityItems, { timeout: 1_500 });
    if (!loc) return [];
    const count = await loc.count().catch(() => 0);
    const out: ActivitySummary[] = [];
    for (let i = 0; i < Math.min(count, 20); i++) {
      const details = await this.textOf(loc.nth(i));
      out.push({ id: null, type: null, details, date: null, author: null });
    }
    return out;
  }
}
