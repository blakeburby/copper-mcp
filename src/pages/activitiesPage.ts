/**
 * Activities page object — the write path for log_activity.
 *
 * SAFETY: this performs a real mutation. It submits exactly ONCE and then
 * verifies the activity appears. It never blindly re-clicks submit (that could
 * duplicate the note). If verification is inconclusive, it throws a clearly
 * labeled error with diagnostics so the caller can check manually rather than
 * re-submitting.
 */
import type { Page } from "playwright";
import { BasePage } from "./basePage.js";
import { activityComposer, recordDetail, routes } from "../selectors/copperSelectors.js";
import type { ActivitySummary, ParentType } from "../types/records.js";
import { CopperToolError, errors } from "../types/errors.js";
import { captureDiagnostics } from "../browser/diagnostics.js";

export interface LogActivityInput {
  parentType: ParentType;
  parentId: string;
  activityType: string;
  details: string;
}

export class ActivitiesPage extends BasePage {
  /**
   * Submit an activity once and verify. Caller (tool) must hold the mutation lock
   * and must have already checked the confirm gate.
   */
  async logActivity(input: LogActivityInput): Promise<ActivitySummary> {
    if (this.cfg.readOnly) {
      throw new CopperToolError(
        "READ_ONLY",
        "Refusing to write: the server is in read-only mode.",
        "Set COPPER_READ_ONLY=false to enable writes. Registration is skipped in this mode, so reaching this method indicates a caller bypassed tool registration.",
      );
    }
    const { parentType, parentId, details } = input;

    // Navigate to the parent record. (Reads/navigation are safe to retry.)
    await this.read("log_activity:navigate", async () => {
      await this.gotoAppRoute(routes.recordView(parentType, encodeURIComponent(parentId)));
      await this.waitForSettled();
      const heading = await this.tryResolve(recordDetail.name);
      if (!heading) {
        throw errors.notFound(
          `${parentType} "${parentId}"`,
          "Could not open the parent record to attach the activity.",
        );
      }
    });

    // Open the composer, fill details.
    const openBtn = await this.resolve(activityComposer.openButton);
    await openBtn.first().click();
    const detailsInput = await this.resolve(activityComposer.detailsInput);
    // The composer is a Froala contenteditable (verified live) with no
    // placeholder, so verify by contenteditable rather than placeholder. The
    // record-field gate still applies: an "Add *" input refuses.
    await this.safeFill(
      detailsInput,
      { attribute: { name: "contenteditable", pattern: /^true$/i } },
      details,
      "activity details editor",
    );

    // Submit EXACTLY ONCE.
    const submit = await this.resolve(activityComposer.submitButton);
    try {
      await submit.first().click();
    } catch (err) {
      const diag = await captureDiagnostics(this.raw, "log_activity_submit", {
        includeHtml: true,
        logger: this.log,
      });
      const e = errors.unexpectedUi(
        `Submitting the activity failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      e.artifactPath = diag.screenshotPath;
      throw e;
    }

    // Verify — wait for the details text to appear in the activity feed.
    const appeared = await this.verifyTextAppears(this.raw, details);
    if (!appeared) {
      const diag = await captureDiagnostics(this.raw, "log_activity_unverified", {
        includeHtml: true,
        logger: this.log,
      });
      const e = new CopperToolError(
        "AMBIGUOUS_RESULT",
        "Activity was submitted but could not be verified in the feed.",
        "Do NOT retry automatically — the note may or may not have saved. Open the record and check before re-submitting.",
      );
      e.artifactPath = diag.screenshotPath;
      throw e;
    }

    return {
      id: null,
      type: input.activityType || "Note",
      details,
      date: null,
      author: null,
    };
  }

  /** Wait (bounded) for the given text to become visible on the page. */
  private async verifyTextAppears(page: Page, text: string): Promise<boolean> {
    const snippet = text.slice(0, 60);
    try {
      await page.getByText(snippet, { exact: false }).first().waitFor({
        state: "visible",
        timeout: this.cfg.defaultTimeoutMs,
      });
      return true;
    } catch {
      return false;
    }
  }
}
