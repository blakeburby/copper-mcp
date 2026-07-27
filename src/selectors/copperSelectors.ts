/**
 * Centralized Copper web-app selectors.
 *
 * SELECTOR STRATEGY (in order of preference):
 *   1. getByRole   2. getByLabel   3. getByPlaceholder   4. visible text
 *   5. stable data-* attributes     6. stable URLs/routes  7. CSS (last resort)
 *
 * ── WHAT LIVE CAPTURE TAUGHT US (2026-07-24, against a real account) ────────
 * Copper is an EMBER app. Three consequences shape everything below:
 *
 *   1. `getByLabel` is UNUSABLE. Copper renders <label> elements with no `for`
 *      attribute and no aria association, so nothing is programmatically
 *      labelled. Placeholders are the reliable handle instead.
 *   2. Element ids are generated (`ember258`) and change every render — NEVER
 *      select on them.
 *   3. Record-detail values live in inline-editable <input> VALUES, not text
 *      nodes. Reading them requires inputValue(), not innerText().
 *
 * Entries are tagged `// VERIFIED <date>` when confirmed against the live UI,
 * `// UNVERIFIED` when still a best-effort guess.
 */
import type { Page, Locator, FrameLocator } from "playwright";

export type Scope = Page | Locator | FrameLocator;

export interface SelectorEntry {
  /** Human description for error messages, e.g. "global search input". */
  description: string;
  /** Preferred resolver. */
  primary: (scope: Scope) => Locator;
  /** Fallback resolver, tried only if the primary yields nothing. */
  fallback: (scope: Scope) => Locator;
  /** True once confirmed against the live UI. */
  verified: boolean;
}

function entry(
  description: string,
  primary: (scope: Scope) => Locator,
  fallback: (scope: Scope) => Locator,
  verified = false,
): SelectorEntry {
  return { description, primary, fallback, verified };
}

/** Record kinds and their Copper URL vocabulary. */
export type EntityKind = "person" | "company" | "opportunity" | "lead";

export const routes = {
  // VERIFIED 2026-07-24 — app.copper.com redirects unauthenticated users to
  // /users/sign_in; SSO/Google/sign-up live under these paths.
  loginSignals: [
    /\/users\/sign_in/i,
    /\/users\/sign_up/i,
    /\/sso\/sign_in/i,
    /\/auth\/google_oauth2/i,
    /accounts\.google\.com/i,
    /\/login/i,
  ],

  // VERIFIED 2026-07-24 — authenticated Copper is an account-scoped SPA at
  // https://app.copper.com/companies/{accountId}/app#/<hash-route>. The account
  // id is per-user and must be read from the live URL (see BasePage.appBaseUrl).
  appShellUrl: /\/companies\/(\d+)\/app/i,

  /** Navigating to the base URL redirects to the shell when authenticated. */
  appHome: "",

  // VERIFIED 2026-07-24 — hash routes read from the live left-nav link hrefs.
  hash: {
    feed: "#/feed",
    people: "#/browse/list/people/default",
    companies: "#/browse/list/companies/default",
    tasks: "#/browse/list/tasks/default",
    // Board view is per-pipeline; pipeline is supplied as a query param.
    opportunities: "#/browse/board/opportunities/default",
  },

  /**
   * Record view. VERIFIED 2026-07-24: Copper has no standalone record page —
   * opening a record adds a `fullProfile` query param to the LIST route and
   * slides a panel over it, e.g.
   *   #/browse/list/people/default?fullProfile=people-184433443
   * The short form `#/contact/{id}` also works and REDIRECTS to the above, so we
   * use the canonical fullProfile form directly.
   */
  recordView: (kind: EntityKind, id: string): string => {
    // Use the SHORT form. VERIFIED 2026-07-24: navigating to
    // #/contact/<id> loads and then redirects itself to the canonical
    // ?fullProfile=... URL, whereas routing straight to the fullProfile form
    // leaves the app stuck on a spinner. Copper evidently needs to resolve the
    // record before the list route can render the panel over it.
    const short: Record<EntityKind, string> = {
      person: "contact",
      company: "company",
      opportunity: "opportunity",
      lead: "lead",
    };
    return `#/${short[kind]}/${id}`;
  },

  /**
   * Extract a record id from any Copper URL/href. VERIFIED 2026-07-24 — handles
   * both `?fullProfile=people-184433443` and `#/contact/184433443`.
   */
  idFromHref(href: string | null | undefined): string | null {
    if (!href) return null;
    const full = href.match(/fullProfile=(?:people|companies|opportunities|leads)-(\d+)/i);
    if (full) return full[1];
    const contact = href.match(/#\/(?:contact|company|opportunity|lead)\/(\d+)/i);
    if (contact) return contact[1];
    const trailing = href.match(/\/(\d+)(?:[/?#]|$)/);
    return trailing ? trailing[1] : null;
  },

  // UNVERIFIED — pipelines settings route.
  pipelinesHash: "#/settings/pipelines",
};

export const auth = {
  /**
   * A DOM signal that the authenticated app shell has loaded. VERIFIED
   * 2026-07-24: the live app has NO role="navigation"/<nav> element, but the
   * global search box and the left-nav hash links exist only once signed in.
   */
  appShell: entry(
    "authenticated app shell (global search / nav links)",
    (s) => asPage(s).getByPlaceholder(/search by name.*email.*domain/i),
    (s) => asPage(s).locator("a[href*='#/browse/list/'], a[href='#/feed']").first(),
    true,
  ),
  /**
   * The login screen. VERIFIED 2026-07-24 against /users/sign_in ("Welcome
   * back!"): an email-first flow with an "Account email" field plus Google/SSO
   * links; no password field appears until after the email step.
   */
  loginForm: entry(
    "login screen",
    (s) => asPage(s).getByPlaceholder(/account email/i),
    (s) => asPage(s).getByRole("link", { name: /sign in with (google|sso)/i }).first(),
    true,
  ),
};

/**
 * App loading indicator. VERIFIED 2026-07-24 from a failure artifact: a record
 * navigation that looked "settled" was still showing
 * `LoadingIcon LoadingIcon-centered` / `CircleSpinner` with no app content at
 * all. networkidle never fires on this SPA (Intercom holds long-poll sockets
 * open), so readiness must be judged from the DOM, not the network.
 */
export const loading = {
  spinner: entry(
    "app loading spinner",
    (s) => asPage(s).locator(".LoadingIcon, .CircleSpinner").first(),
    (s) => asPage(s).locator("[class*='Loading' i], [class*='Spinner' i]").first(),
    true,
  ),
};

export const globalSearch = {
  /**
   * The global/omni search box. VERIFIED 2026-07-24 — a plain text input with
   * placeholder "Search by name, email, domain or phone number" (no
   * role="searchbox", no aria-label).
   */
  input: entry(
    "global search input",
    (s) => asPage(s).getByPlaceholder(/search by name.*email.*domain/i),
    (s) => asPage(s).getByPlaceholder(/search/i).first(),
    true,
  ),
};

/**
 * List views. VERIFIED 2026-07-24 — a populated list IS a real HTML <table>:
 *   tbody.ListViewTableBody > tr.et-tr.ember-view > td (x11)
 * Native <tr> carries an implicit ARIA role of "row", so getByRole("row") is a
 * valid primary. (An EMPTY account shows an onboarding panel with no table at
 * all — do not mistake that screen for the list markup.)
 */
export const list = {
  rows: entry(
    "result rows",
    (s) => asScope(s).getByRole("row"),
    (s) => asScope(s).locator("tbody.ListViewTableBody tr.et-tr, tbody tr, [class*='_row' i]"),
    true,
  ),
  /**
   * The record link inside a row. VERIFIED 2026-07-24 — `a.fullProfileLink`
   * whose href carries `?fullProfile=<plural>-<id>`.
   */
  rowLink: entry(
    "record link within a row",
    (s) => asScope(s).locator("a.fullProfileLink").first(),
    (s) => asScope(s).locator("a[href*='fullProfile='], a[href*='#/']").first(),
    true,
  ),
  /**
   * Clean record name inside a row link. VERIFIED 2026-07-24 — the link's
   * innerText also contains the avatar initial ("J\nJim Halpert"), so the name
   * must be read from the AvatarPill text span.
   */
  rowName: entry(
    "record name within a row link",
    (s) => asScope(s).locator(".AvatarPill_text").first(),
    (s) => asScope(s).locator("a.fullProfileLink").first(),
    true,
  ),
  /**
   * Empty state. VERIFIED 2026-07-24 for the global quick-search typeahead
   * ("No Quick Search Results Found", .GlobalSearchEmptyState). The list-view
   * empty screen is an onboarding panel — its copy is matched loosely here.
   */
  emptyState: entry(
    "empty-results indicator",
    (s) =>
      asPage(s).getByText(
        /no quick search results found|start bringing your relationships|no results|nothing found/i,
      ),
    (s) => asPage(s).locator(".GlobalSearchEmptyState, [data-testid='empty-state']"),
    true,
  ),
};

/**
 * Record detail (the "full profile" slide-over).
 * VERIFIED 2026-07-24 — container `.EntityFullProfileFrame-fullProfile`. Values
 * are held in inline-editable <input> VALUES keyed by placeholder, NOT text
 * nodes, and there is NO heading element for the record name. Read these with
 * BasePage.valueOf(), not textOf().
 */
export const recordDetail = {
  panel: entry(
    "record full-profile panel",
    (s) => asPage(s).locator("[class*='EntityFullProfileFrame-fullProfile']"),
    (s) => asPage(s).locator("[class*='FullProfile' i]").first(),
    true,
  ),
  /**
   * Record name. There is no <h1>/<h2>; the name lives in the "Add Name" input
   * value. document.title also mirrors it (used as a page-level fallback).
   */
  name: entry(
    "record name field",
    (s) => asPage(s).getByPlaceholder("Add Name").first(),
    (s) => asPage(s).locator("input[placeholder='Add Name'], .AvatarPill_text").first(),
    true,
  ),
  /**
   * A record field addressed by its Copper placeholder, e.g. "Add Title".
   * VERIFIED placeholders: Add Name, Add Company, Add Title, Add Owner,
   * Add Email, Add Phone, Add Website, Add Social, Add Description, Add Tag.
   */
  fieldByPlaceholder: (placeholder: string): SelectorEntry =>
    entry(
      `record field "${placeholder}"`,
      (s) => asPage(s).getByPlaceholder(placeholder).first(),
      (s) =>
        asPage(s)
          .locator(`input[placeholder="${placeholder}"], textarea[placeholder="${placeholder}"]`)
          .first(),
      true,
    ),
  /** Values Copper renders as read-only text rather than an input. */
  readOnlyValues: entry(
    "read-only field values",
    (s) => asPage(s).locator(".EntityField_value"),
    (s) => asPage(s).locator("[class*='Field_value' i]"),
    true,
  ),
  /** Tags. UNVERIFIED — the demo record had no tags to confirm the rendered shape. */
  tags: entry(
    "record tags",
    (s) => asPage(s).locator("[class*='Tag_' i], [class*='TagPill' i]"),
    (s) => asPage(s).getByRole("listitem"),
    false,
  ),
  /**
   * Activity feed entries. VERIFIED 2026-07-24 — see `activityFeed` below for the
   * full per-item anatomy. Kept here for backwards compatibility.
   */
  activityItems: entry(
    "activity feed items",
    (s) => asPage(s).locator(".ActivityItem"),
    (s) => asPage(s).locator("[class*='ActivityItem' i]"),
    true,
  ),
};

/**
 * Activity feed anatomy. VERIFIED 2026-07-24 by logging a real Phone Call
 * activity on a live record and reading the rendered DOM:
 *
 *   .ActivityList > .ActivityLogList > .ActivityItem[.ActivityItem-<kind>]
 *     ├─ h4.ActivityItem_label                  "Today"  (day grouping header)
 *     ├─ .ActivityItem_header > span.ActivityItem_headerContent
 *     │     └─ <a>You</a> + " logged a Phone Call"   ← ACTOR + TYPE
 *     └─ .ActivityItem_date > <time datetime="2026-07-24T21:30:39.000Z"
 *                                   title="Jul 24, 2026 at 2:30 PM">2:30 PM</time>
 *
 * The `datetime` attribute is a full ISO-8601 UTC instant — parse that, never the
 * human-readable "2:30 PM" text, which is timezone- and locale-dependent.
 */
export const activityFeed = {
  /** The scrollable feed container. */
  list: entry(
    "activity feed list",
    (s) => asPage(s).locator(".ActivityLogList"),
    (s) => asPage(s).locator(".ActivityList, [class*='ActivityLogList' i]"),
    true,
  ),
  /** One repeating feed entry. */
  item: entry(
    "activity feed item",
    (s) => asScope(s).locator(".ActivityItem"),
    (s) => asScope(s).locator("[class*='ActivityItem' i]"),
    true,
  ),
  /** Header line carrying the actor link and the activity phrasing. */
  header: entry(
    "activity item header",
    (s) => asScope(s).locator(".ActivityItem_headerContent").first(),
    (s) => asScope(s).locator("[class*='ActivityItem_header' i]").first(),
    true,
  ),
  /** The actor: "You" for the signed-in rep, otherwise a person's name. */
  actorLink: entry(
    "activity item actor link",
    (s) => asScope(s).locator(".ActivityItem_headerContent a").first(),
    (s) => asScope(s).locator("[class*='headerContent' i] a").first(),
    true,
  ),
  /** <time datetime="ISO"> — the authoritative timestamp. */
  timestamp: entry(
    "activity item timestamp",
    (s) => asScope(s).locator(".ActivityItem_date time").first(),
    (s) => asScope(s).locator("time[datetime]").first(),
    true,
  ),
  /** The note/body text of a logged activity. */
  body: entry(
    "activity item body",
    (s) => asScope(s).locator(".ActivityItem_contentWrapper").first(),
    (s) => asScope(s).locator("[class*='ActivityItem_content' i]").first(),
    true,
  ),
};

/**
 * Create-entity modal shared chrome.
 * VERIFIED 2026-07-24 — the modal has NO role="dialog"; its save/cancel buttons
 * carry `ModalFormFrameworkCreateEntity_saveButton` / `_cancelButton`.
 */
export const createModal = {
  saveButton: entry(
    "create-modal save button",
    (s) => asPage(s).locator("button[class*='ModalFormFrameworkCreateEntity_saveButton']"),
    (s) => asPage(s).getByRole("button", { name: /^save$/i }).first(),
    true,
  ),
  cancelButton: entry(
    "create-modal cancel button",
    (s) => asPage(s).locator("button[class*='ModalFormFrameworkCreateEntity_cancelButton']"),
    (s) => asPage(s).getByRole("button", { name: /^cancel$/i }).first(),
    true,
  ),
  /** Left-nav "Create New" launcher. VERIFIED 2026-07-24. */
  createNewButton: entry(
    "Create New button",
    (s) => asPage(s).locator("button[class*='LeftNavigation_create']"),
    (s) => asPage(s).getByRole("button", { name: /create new/i }).first(),
    true,
  ),
  /** An entry in the Create New menu ("Person", "Company", "Task"). VERIFIED. */
  createMenuItem: (label: string): SelectorEntry =>
    entry(
      `Create New menu item "${label}"`,
      (s) => asPage(s).getByRole("button", { name: new RegExp(`^${escapeRegex(label)}$`, "i") }),
      (s) => asPage(s).locator("button").filter({ hasText: new RegExp(`^${escapeRegex(label)}$`) }),
      true,
    ),
};

/**
 * Typeahead option list (company pickers, "Related To", owner pickers).
 * VERIFIED 2026-07-24 — `.Typeahead_options li.js-optionItem`, with a
 * `Create "<value>"` affordance when no existing record matches.
 */
export const typeahead = {
  options: entry(
    "typeahead option list",
    (s) => asPage(s).locator(".Typeahead_options li.js-optionItem"),
    (s) => asPage(s).locator(".OptionList li, [class*='OptionListItem']"),
    true,
  ),
  createOption: (value: string): SelectorEntry =>
    entry(
      `typeahead "Create ${value}" option`,
      (s) => asPage(s).locator("li.js-optionItem").filter({ hasText: `Create "${value}"` }).first(),
      (s) => asPage(s).getByText(`Create "${value}"`).first(),
      true,
    ),
};

/**
 * Task composer ("Add a New Task" modal).
 * VERIFIED 2026-07-24 — fields are addressed by placeholder. NOTE the due-date
 * input's placeholder is TODAY'S DATE (e.g. "7/24/2026"), so it cannot be
 * matched by a literal string; the locator below is therefore UNVERIFIED.
 */
export const taskComposer = {
  titleInput: entry(
    "task name input",
    (s) => asPage(s).getByPlaceholder("Add Name").first(),
    (s) => asPage(s).locator("input[placeholder='Add Name']").first(),
    true,
  ),
  relatedToInput: entry(
    "task Related To input",
    (s) => asPage(s).getByPlaceholder("Add Relation").first(),
    (s) => asPage(s).locator("input[placeholder='Add Relation']").first(),
    true,
  ),
  descriptionInput: entry(
    "task description input",
    (s) => asPage(s).getByPlaceholder("Add Description").first(),
    (s) => asPage(s).locator("textarea[placeholder='Add Description']").first(),
    true,
  ),
  /** Due date. UNVERIFIED locator — placeholder is dynamic (today's date). */
  dueDateInput: entry(
    "task due date input",
    (s) => asPage(s).locator("input[placeholder*='/']").first(),
    (s) => asPage(s).locator("input[type='date'], input[name*='due' i]").first(),
    false,
  ),
  submitButton: createModal.saveButton,
};

/**
 * Person composer ("Add a New Person" modal).
 * VERIFIED 2026-07-24 — all placeholders confirmed live.
 */
export const personComposer = {
  firstName: entry(
    "person first name input",
    (s) => asPage(s).getByPlaceholder("First Name").first(),
    (s) => asPage(s).locator("input[placeholder='First Name']").first(),
    true,
  ),
  lastName: entry(
    "person last name input",
    (s) => asPage(s).getByPlaceholder("Last Name").first(),
    (s) => asPage(s).locator("input[placeholder='Last Name']").first(),
    true,
  ),
  company: entry(
    "person company input",
    (s) => asPage(s).getByPlaceholder("Add Company").first(),
    (s) => asPage(s).locator("input[placeholder='Add Company']").first(),
    true,
  ),
  title: entry(
    "person title input",
    (s) => asPage(s).getByPlaceholder("Add Title").first(),
    (s) => asPage(s).locator("input[placeholder='Add Title']").first(),
    true,
  ),
  email: entry(
    "person email input",
    (s) => asPage(s).getByPlaceholder("Add Email").first(),
    (s) => asPage(s).locator("input[placeholder='Add Email']").first(),
    true,
  ),
  phone: entry(
    "person phone input",
    (s) => asPage(s).getByPlaceholder("Add Phone").first(),
    (s) => asPage(s).locator("input[placeholder='Add Phone']").first(),
    true,
  ),
  submitButton: createModal.saveButton,
};

/**
 * Activity composer. UNVERIFIED — the activity/note composer lives on the record
 * panel and was not exercised during capture.
 */
export const activityComposer = {
  openButton: entry(
    "log activity / add note button",
    (s) => asPage(s).getByRole("button", { name: /log|add note|activity/i }).first(),
    (s) => asPage(s).locator("[class*='ActivityComposer' i] button").first(),
    false,
  ),
  detailsInput: entry(
    "activity details textarea",
    (s) => asPage(s).getByPlaceholder(/note|detail|activity|what did you/i).first(),
    (s) => asPage(s).locator("textarea, [contenteditable='true']").first(),
    false,
  ),
  submitButton: entry(
    "activity submit button",
    (s) => asPage(s).getByRole("button", { name: /^(save|log|add|post)$/i }).first(),
    (s) => asPage(s).locator("[class*='ActivityComposer' i] button[type='submit']").first(),
    false,
  ),
};

/** Pipelines settings screen. UNVERIFIED. */
export const pipelines = {
  pipelineBlocks: entry(
    "pipeline blocks",
    (s) => asPage(s).locator("[class*='Pipeline' i][class*='row' i], [class*='PipelineCard' i]"),
    (s) => asPage(s).getByRole("region"),
    false,
  ),
  stageChips: entry(
    "pipeline stage chips",
    (s) => asScope(s).locator("[class*='Stage' i]"),
    (s) => asScope(s).getByRole("listitem"),
    false,
  ),
};

// --- helpers -----------------------------------------------------------------

function asPage(scope: Scope): Page {
  // Page, Locator and FrameLocator all expose getBy* / locator; we only rely on
  // those, so a widened structural type is fine here.
  return scope as unknown as Page;
}
function asScope(scope: Scope): Locator {
  return scope as unknown as Locator;
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
