/**
 * Tasks page object — the write path for create_task.
 *
 * SAFETY: mirrors ActivitiesPage. Submits exactly once, verifies the task
 * appears, and never blindly retries. Duplicate prevention: before submitting we
 * record whether a task with the same title already exists; after an
 * inconclusive submit we surface an AMBIGUOUS_RESULT instead of re-submitting.
 */
import type { Page } from "playwright";
import { BasePage } from "./basePage.js";
import {
  taskComposer,
  createModal,
  recordDetail,
  routes,
} from "../selectors/copperSelectors.js";
import type { TaskSummary, ParentType } from "../types/records.js";
import { CopperToolError, errors } from "../types/errors.js";
import { captureDiagnostics } from "../browser/diagnostics.js";

export interface CreateTaskInput {
  title: string;
  dueDate?: string;
  parentType: ParentType;
  parentId: string;
  description?: string;
}

export class TasksPage extends BasePage {
  async createTask(input: CreateTaskInput): Promise<TaskSummary> {
    const { title, dueDate, description, parentType, parentId } = input;

    // Open the parent record (safe to retry).
    await this.read("create_task:navigate", async () => {
      await this.gotoAppRoute(routes.recordView(parentType, encodeURIComponent(parentId)));
      await this.waitForSettled();
      const heading = await this.tryResolve(recordDetail.name);
      if (!heading) {
        throw errors.notFound(
          `${parentType} "${parentId}"`,
          "Could not open the parent record to attach the task.",
        );
      }
    });

    // Guard against an obvious duplicate before writing.
    const preExisting = await this.taskWithTitleExists(this.raw, title);
    if (preExisting) {
      throw new CopperToolError(
        "AMBIGUOUS_RESULT",
        `A task titled "${title}" already appears on this record.`,
        "Refusing to create a probable duplicate. Use a distinct title or verify manually.",
      );
    }

    // Open the composer via the left-nav "Create New" → "Task" menu. VERIFIED
    // 2026-07-24: there is no inline "add task" button on the record panel; the
    // Create New menu is the entry point, and the composer is a modal.
    const createNew = await this.resolve(createModal.createNewButton);
    await createNew.first().click();
    const taskMenuItem = await this.resolve(createModal.createMenuItem("Task"));
    await taskMenuItem.first().click();

    const titleInput = await this.resolve(taskComposer.titleInput);
    await titleInput.first().click();
    await titleInput.first().fill(title);

    // Attach the task to the parent record via the "Related To" typeahead.
    const relatedTo = await this.tryResolve(taskComposer.relatedToInput, { timeout: 2_000 });
    if (relatedTo) {
      await relatedTo.first().click();
      await relatedTo.first().fill(parentId);
    }

    if (dueDate) {
      const dueInput = await this.tryResolve(taskComposer.dueDateInput, { timeout: 2_000 });
      if (dueInput) await dueInput.first().fill(dueDate);
    }
    if (description) {
      const descInput = await this.tryResolve(taskComposer.descriptionInput, { timeout: 2_000 });
      if (descInput) await descInput.first().fill(description);
    }

    // Submit ONCE.
    const submit = await this.resolve(taskComposer.submitButton);
    try {
      await submit.first().click();
    } catch (err) {
      const diag = await captureDiagnostics(this.raw, "create_task_submit", {
        includeHtml: true,
        logger: this.log,
      });
      const e = errors.unexpectedUi(
        `Submitting the task failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      e.artifactPath = diag.screenshotPath;
      throw e;
    }

    // Verify.
    const appeared = await this.taskWithTitleExists(this.raw, title, this.cfg.defaultTimeoutMs);
    if (!appeared) {
      const diag = await captureDiagnostics(this.raw, "create_task_unverified", {
        includeHtml: true,
        logger: this.log,
      });
      const e = new CopperToolError(
        "AMBIGUOUS_RESULT",
        "Task was submitted but could not be verified.",
        "Do NOT retry automatically — the task may or may not have saved. Check the record before re-creating.",
      );
      e.artifactPath = diag.screenshotPath;
      throw e;
    }

    return {
      id: null,
      title,
      dueDate: dueDate ?? null,
      status: "open",
      relatedTo: `${parentType}:${parentId}`,
      recordUrl: this.raw.url(),
    };
  }

  /** Whether a task with the given title is visible on the page (bounded wait). */
  private async taskWithTitleExists(page: Page, title: string, timeout = 2_000): Promise<boolean> {
    try {
      await page
        .getByText(title.slice(0, 60), { exact: false })
        .first()
        .waitFor({ state: "visible", timeout });
      return true;
    } catch {
      return false;
    }
  }
}
