/**
 * Opportunities page object: search (with optional best-effort filters), single
 * record detail, and pipeline/stage listing.
 *
 * Filters (pipeline/stage/owner/status/close-date) are applied via the query text
 * when the UI can't be driven reliably; unsupported filters are reported back to
 * the caller in the tool layer rather than silently dropped. Selectors UNVERIFIED.
 */
import { BasePage } from "./basePage.js";
import { routes, recordDetail, pipelines } from "../selectors/copperSelectors.js";
import type {
  OpportunitySummary,
  OpportunityDetail,
  PipelineSummary,
  ActivitySummary,
} from "../types/records.js";
import { errors } from "../types/errors.js";

export interface OpportunitySearchInput {
  query?: string;
  pipeline?: string;
  stage?: string;
  owner?: string;
  status?: string;
  closeDateFrom?: string;
  closeDateTo?: string;
  limit: number;
}

export class OpportunitiesPage extends BasePage {
  async search(input: OpportunitySearchInput): Promise<OpportunitySummary[]> {
    return this.read("search_opportunities", async () => {
      await this.gotoAppRoute(routes.hash.opportunities);
      // Compose a text query from the free-text plus any provided filter hints.
      const terms = [input.query, input.pipeline, input.stage, input.owner, input.status]
        .filter((t): t is string => !!t && t.trim().length > 0)
        .join(" ");
      if (terms) {
        await this.fillGlobalSearch(terms);
      } else {
        await this.waitForSettled();
      }
      const rows = await this.collectRowLinks(input.limit);
      return rows.map((r) => this.toSummary(r.name, r.href));
    });
  }

  async get(opportunityId: string): Promise<OpportunityDetail> {
    return this.read("get_opportunity", async () => {
      await this.gotoAppRoute(routes.recordView("opportunity", encodeURIComponent(opportunityId)));
      await this.waitForSettled();

      const nameLoc = await this.tryResolve(recordDetail.name);
      const name = await this.valueOf(nameLoc);
      if (!name) {
        throw errors.notFound(
          `Opportunity "${opportunityId}"`,
          "No record heading was found at the record URL.",
        );
      }

      const [companyName, pipeline, stage, status, owner, value, closeDate, primaryContact] =
        await Promise.all([
          this.field("Add Company"),
          this.field("Add Pipeline"),
          this.field("Add Stage"),
          this.field("Add Status"),
          this.field("Add Owner"),
          this.field("Add Value"),
          this.field("Add Close Date"),
          this.field("Add Primary Contact"),
        ]);

      const recordUrl = this.raw.url();
      const activities = await this.activities();
      const tags = await this.tags();

      return {
        id: opportunityId ?? this.idFromUrl(recordUrl),
        name,
        companyName,
        pipeline,
        stage,
        status,
        owner,
        value,
        closeDate,
        primaryContact,
        tags,
        activities,
        recordUrl,
      };
    });
  }

  /** List pipelines and their visible stages from the pipelines settings screen. */
  async listPipelines(): Promise<PipelineSummary[]> {
    return this.read("list_pipelines", async () => {
      await this.gotoAppRoute(routes.pipelinesHash);
      await this.waitForSettled();

      const blocks = await this.tryResolve(pipelines.pipelineBlocks);
      if (!blocks) {
        throw errors.unexpectedUi(
          "Could not find any pipeline blocks on the pipelines settings screen.",
        );
      }
      const count = await blocks.count().catch(() => 0);
      const out: PipelineSummary[] = [];
      for (let i = 0; i < Math.min(count, 50); i++) {
        const block = blocks.nth(i);
        const name = await this.textOf(pipelines.pipelineBlocks.primary(block).first());
        const stageLoc = pipelines.stageChips.primary(block);
        const stageCount = await stageLoc.count().catch(() => 0);
        const stages: string[] = [];
        for (let j = 0; j < Math.min(stageCount, 40); j++) {
          const s = await this.textOf(stageLoc.nth(j));
          if (s) stages.push(s);
        }
        out.push({ id: null, name, stages });
      }
      return out;
    });
  }

  private toSummary(name: string | null, href: string | null): OpportunitySummary {
    return {
      id: this.idFromUrl(href),
      name,
      companyName: null,
      pipeline: null,
      stage: null,
      status: null,
      owner: null,
      value: null,
      closeDate: null,
      recordUrl: href,
    };
  }

  private async field(label: string): Promise<string | null> {
    const loc = await this.tryResolve(recordDetail.fieldByPlaceholder(label), { timeout: 1_500 });
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
