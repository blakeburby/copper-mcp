/**
 * People (contacts) page object.
 *
 * FIDELITY: search, the record-view route, and the name/title/company/email/
 * phone/owner field placeholders were VERIFIED against the live Copper UI on
 * 2026-07-24. Tags and the activity feed remain UNVERIFIED (the account used for
 * capture had neither), so those return [] rather than guessing.
 */
import { BasePage } from "./basePage.js";
import { routes, recordDetail } from "../selectors/copperSelectors.js";
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
      await this.gotoAppRoute(routes.recordView("person", encodeURIComponent(personId)));
      await this.waitForSettled();

      // The record name lives in the "Add Name" input value, not a heading.
      // document.title mirrors it, so use that as a last resort.
      const nameLoc = await this.tryResolve(recordDetail.name);
      let name = await this.valueOf(nameLoc);
      if (!name) {
        const title = await this.raw.title().catch(() => "");
        if (title && !/^copper$/i.test(title.trim())) name = title.trim();
      }
      if (!name) {
        throw errors.notFound(
          `Person "${personId}"`,
          "The record panel did not render a name field at the record URL.",
        );
      }

      const [title, companyName, email, phone, owner] = await Promise.all([
        this.field("Add Title"),
        this.field("Add Company"),
        this.field("Add Email"),
        this.field("Add Phone"),
        this.field("Add Owner"),
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

  /**
   * Read a record field by its Copper placeholder (e.g. "Add Title"). Values are
   * input values, not text — see BasePage.valueOf().
   */
  private async field(placeholder: string): Promise<string | null> {
    const loc = await this.tryResolve(recordDetail.fieldByPlaceholder(placeholder), {
      timeout: 1_500,
    });
    return this.valueOf(loc);
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
