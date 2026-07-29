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
import { errors, CopperToolError } from "../types/errors.js";

export class PeoplePage extends BasePage {
  /**
   * FAST path — read a person's detail from `contacts_api/<id>` JSON via an
   * authenticated in-page fetch, instead of navigating to the record. Returns the
   * same PersonDetail (activities left empty — read those via
   * get_person_activities). VERIFIED live 2026-07-28: top-level
   * first_name/last_name/title/primary_email, with the primary organization
   * embedded (its `name` is the company). A non-200/non-JSON response THROWS, so
   * the caller falls back to the DOM reader.
   */
  async getJson(personId: string): Promise<PersonDetail> {
    const url = this.raw.url();
    const accountId = url.match(/\/companies\/(\d+)\//)?.[1];
    if (!accountId) {
      throw new CopperToolError(
        "SELECTOR_FAILURE",
        "Not on the Copper app shell (no account id in URL); cannot use the JSON reader.",
      );
    }
    const origin = new URL(url).origin;
    const res = await this.raw.evaluate(async (u: string) => {
      try {
        const r = await fetch(u, { credentials: "include", headers: { accept: "application/json" } });
        return { status: r.status, body: await r.text() };
      } catch (e) {
        return { status: 0, body: e instanceof Error ? e.message : String(e) };
      }
    }, `${origin}/api/v1/companies/${accountId}/contacts_api/${encodeURIComponent(personId)}`);

    if (res.status !== 200) {
      throw new CopperToolError("SELECTOR_FAILURE", `contacts_api returned HTTP ${res.status}.`);
    }
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      throw new CopperToolError("SELECTOR_FAILURE", "contacts_api response was not JSON.");
    }

    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
    const first = str(j.first_name);
    const last = str(j.last_name);
    const name = str(j.validName) ?? ([first, last].filter(Boolean).join(" ") || null);
    const org = (j.primary_organization ?? j.organization) as { name?: string } | null | undefined;
    const companyName = str(org?.name) ?? str(j.company_name);
    const emails = Array.isArray(j.email_addresses) ? (j.email_addresses as unknown[]).map(String) : [];
    const email = str(j.primary_email) ?? emails[0] ?? null;
    const phone = str(j.primary_phone);
    const tags = Array.isArray(j.tags) ? (j.tags as unknown[]).map(String) : [];

    return {
      id: personId,
      name,
      title: str(j.title),
      companyName,
      email,
      phone,
      owner: null,
      tags,
      recordUrl: `${origin}/companies/${accountId}/app#/contact/${personId}`,
      emails: emails.length ? emails : email ? [email] : [],
      phones: phone ? [phone] : [],
      activities: [],
    };
  }

  /** Search people by free text; returns lightweight summaries. */
  async search(query: string, limit: number): Promise<PersonSummary[]> {
    return this.read("search_people", async () => {
      await this.gotoAppRoute(routes.hash.people);
      await this.fillGlobalSearch(query);
      const rows = await this.collectRowLinks(limit);
      return rows.map((r) => this.toSummary(r.name, r.href));
    });
  }

  /**
   * List people from the People view WITHOUT searching.
   *
   * search_people needs a query, which makes "sync everyone" awkward and
   * silently partial — a query that matches nothing looks identical to an empty
   * CRM. Loading the list directly is the honest primitive for enumeration.
   *
   * Scrolls to enumerate the WHOLE roster (Copper virtualizes the list, so a
   * single DOM read would only see the first screen). `complete` reports whether
   * the end was reached or `cap` truncated the result — the caller must surface
   * a truncation, never treat a partial roster as the whole account.
   */
  async list(cap: number): Promise<{ people: PersonSummary[]; complete: boolean }> {
    return this.read("list_people", async () => {
      await this.gotoAppRoute(routes.hash.people);
      const { rows, complete } = await this.collectAllRowLinks(cap);
      return { people: rows.map((r) => this.toSummary(r.name, r.href)), complete };
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
