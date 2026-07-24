/**
 * Centralized Copper web-app selectors.
 *
 * SELECTOR STRATEGY (in order of preference):
 *   1. getByRole   2. getByLabel   3. getByPlaceholder   4. visible text
 *   5. stable data-* attributes     6. stable URLs/routes  7. CSS (last resort)
 *
 * Every entry provides a PRIMARY and a FALLBACK resolver plus a human description
 * used in error messages. `basePage.resolve()` tries primary, then fallback, then
 * throws a descriptive SELECTOR_FAILURE.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ VERIFICATION STATUS                                                        │
 * │ Entries tagged `// UNVERIFIED` are best-effort guesses that have NOT been   │
 * │ confirmed against the live Copper UI. They must be validated with the      │
 * │ manual checklist in the README before the corresponding tool is trusted.   │
 * │ Entries tagged `// VERIFIED <date>` were confirmed against the live DOM.    │
 * └───────────────────────────────────────────────────────────────────────────┘
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

/**
 * Route/URL patterns. Copper is a single-page app; these are the stable-ish
 * hash/path fragments used to detect and drive navigation. UNVERIFIED — confirm
 * the exact routes during live capture.
 */
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

  // VERIFIED 2026-07-24 — once authenticated, Copper is an account-scoped SPA at
  // https://app.copper.com/companies/{accountId}/app#/<hash-route>. The account id
  // is per-user and must be read from the live URL (see BasePage.appBaseUrl()).
  appShellUrl: /\/companies\/(\d+)\/app/i,

  // Navigating to the app root redirects to the shell when authenticated (or to
  // /users/sign_in when not). Empty string => the base URL itself.
  appHome: "",

  // VERIFIED 2026-07-24 — hash routes read from the live left-nav link hrefs.
  hash: {
    feed: "#/feed",
    people: "#/browse/list/people/default",
    companies: "#/browse/list/companies/default",
    tasks: "#/browse/list/tasks/default",
    // Board view is per-pipeline; the default board route (pipeline param optional).
    opportunities: "#/browse/board/opportunities/default",
  },

  // UNVERIFIED — record-view hash route. The demo account had no records, so the
  // exact per-record route could not be confirmed. Update the builders below once
  // validated against a populated account (see README manual checklist).
  recordView: {
    person: (id: string): string => `#/view/entity/person/${id}`,
    company: (id: string): string => `#/view/entity/company/${id}`,
    opportunity: (id: string): string => `#/view/entity/opportunity/${id}`,
    lead: (id: string): string => `#/view/entity/lead/${id}`,
  },

  // UNVERIFIED — pipelines settings route.
  pipelinesHash: "#/settings/pipelines",
};

export const auth = {
  /**
   * A DOM signal that the authenticated app shell has loaded. VERIFIED 2026-07-24:
   * the live app has NO role="navigation"/<nav> element, but the global search box
   * ("Search by name, email, domain or phone number") and the left-nav list links
   * (href="#/browse/list/...") are present only when authenticated.
   */
  appShell: entry(
    "authenticated app shell (global search / nav links)",
    (s) => asPage(s).getByPlaceholder(/search by name.*email.*domain/i),
    (s) => asPage(s).locator("a[href*='#/browse/list/'], a[href='#/feed']").first(),
    true,
  ),
  /**
   * A DOM signal that we are on the login screen. VERIFIED 2026-07-24 against the
   * /users/sign_in "Welcome back!" screen (email-first flow: an "Account email"
   * field plus "Sign in with Google" / "Sign in with SSO" links; no password
   * field is shown until after the email step).
   */
  loginForm: entry(
    "login screen",
    (s) => asPage(s).getByPlaceholder(/account email/i),
    (s) => asPage(s).getByRole("link", { name: /sign in with (google|sso)/i }).first(),
    true,
  ),
};

export const globalSearch = {
  /**
   * The global/omni search box. VERIFIED 2026-07-24 — it is a plain text input
   * with placeholder "Search by name, email, domain or phone number" (no
   * role="searchbox", no aria-label).
   */
  input: entry(
    "global search input",
    (s) => asPage(s).getByPlaceholder(/search by name.*email.*domain/i),
    (s) => asPage(s).getByPlaceholder(/search/i),
    true,
  ),
};

/**
 * Generic list result rows shared by search screens.
 *
 * UNVERIFIED — the demo account had no records, so the row structure could not be
 * confirmed. NOTE from live capture (2026-07-24): the People/Companies list is
 * NOT an HTML <table> and exposes NO role="row"/role="grid" — it is a custom
 * div-based list. The primary `getByRole("row")` will therefore likely MISS and
 * fall through to the CSS fallback; update both against a populated account.
 */
export const list = {
  rows: entry(
    "result rows",
    (s) => asScope(s).getByRole("row"),
    (s) =>
      asScope(s).locator(
        [
          "[data-testid='list-row']",
          "[class*='ListRow' i]",
          "[class*='TableRow' i]",
          // Copper's markup follows a `Component_element` convention (confirmed
          // via GlobalSearchEmptyState_title etc.), so a row is plausibly
          // `SomethingList_row`. Broad on purpose: this is the fallback.
          "[class*='_row' i]",
          "tbody tr",
          "[role='listitem']",
        ].join(", "),
      ),
    false,
  ),
  /** A cell/link that carries the record name + href. UNVERIFIED. */
  rowLink: entry(
    "record link within a row",
    (s) => asScope(s).getByRole("link"),
    (s) => asScope(s).locator("a[href*='#/']"),
    false,
  ),
  /**
   * Empty-results indicator. VERIFIED 2026-07-24 for the global quick-search
   * typeahead ("No Quick Search Results Found", class `GlobalSearchEmptyState`).
   * The list-view empty state text is included but UNVERIFIED.
   */
  emptyState: entry(
    "empty-results indicator",
    (s) => asPage(s).getByText(/no quick search results found|no results|nothing found|no matches/i),
    (s) => asPage(s).locator(".GlobalSearchEmptyState, [data-testid='empty-state']"),
    true,
  ),
};

/** Fields commonly shown on a record detail page. UNVERIFIED. */
export const recordDetail = {
  name: entry(
    "record name heading",
    (s) => asPage(s).getByRole("heading").first(),
    (s) => asPage(s).locator("[data-testid='record-name'], h1, h2").first(),
    false,
  ),
  fieldByLabel: (label: string): SelectorEntry =>
    entry(
      `record field "${label}"`,
      (s) => asPage(s).getByLabel(new RegExp(`^${escapeRegex(label)}$`, "i")),
      (s) =>
        asPage(s)
          .locator(`xpath=//*[normalize-space(text())='${label}']/following::*[1]`)
          .first(),
      false,
    ),
  tags: entry(
    "record tags",
    (s) => asPage(s).getByRole("listitem").filter({ hasText: /.+/ }),
    (s) => asPage(s).locator("[data-testid='tag'], .tag"),
    false,
  ),
  activityItems: entry(
    "activity feed items",
    (s) => asPage(s).getByRole("article"),
    (s) => asPage(s).locator("[data-testid='activity-item'], .activity"),
    false,
  ),
};

/** Log-activity composer. UNVERIFIED. */
export const activityComposer = {
  openButton: entry(
    "log activity / add note button",
    (s) => asPage(s).getByRole("button", { name: /log|add note|activity/i }),
    (s) => asPage(s).locator("[data-testid='log-activity']"),
    false,
  ),
  detailsInput: entry(
    "activity details textarea",
    (s) => asPage(s).getByRole("textbox", { name: /note|details|activity/i }),
    (s) => asPage(s).locator("textarea, [contenteditable='true']").first(),
    false,
  ),
  submitButton: entry(
    "activity submit button",
    (s) => asPage(s).getByRole("button", { name: /save|log|add|post/i }),
    (s) => asPage(s).locator("[data-testid='activity-submit']"),
    false,
  ),
};

/** Create-task form. UNVERIFIED. */
export const taskComposer = {
  openButton: entry(
    "add task button",
    (s) => asPage(s).getByRole("button", { name: /add task|new task|create task/i }),
    (s) => asPage(s).locator("[data-testid='add-task']"),
    false,
  ),
  titleInput: entry(
    "task title input",
    (s) => asPage(s).getByRole("textbox", { name: /title|name|task/i }),
    (s) => asPage(s).locator("input[name='name'], input[name='title']").first(),
    false,
  ),
  dueDateInput: entry(
    "task due date input",
    (s) => asPage(s).getByLabel(/due/i),
    (s) => asPage(s).locator("input[name='due_date'], input[type='date']").first(),
    false,
  ),
  descriptionInput: entry(
    "task description input",
    (s) => asPage(s).getByRole("textbox", { name: /description|details/i }),
    (s) => asPage(s).locator("textarea[name='details'], textarea").first(),
    false,
  ),
  submitButton: entry(
    "task submit button",
    (s) => asPage(s).getByRole("button", { name: /save|create|add/i }),
    (s) => asPage(s).locator("[data-testid='task-submit']"),
    false,
  ),
};

/** Pipelines settings screen. UNVERIFIED. */
export const pipelines = {
  pipelineBlocks: entry(
    "pipeline blocks",
    (s) => asPage(s).getByRole("region"),
    (s) => asPage(s).locator("[data-testid='pipeline'], .pipeline"),
    false,
  ),
  stageChips: entry(
    "pipeline stage chips",
    (s) => asScope(s).getByRole("listitem"),
    (s) => asScope(s).locator("[data-testid='stage'], .stage"),
    false,
  ),
};

// --- helpers -----------------------------------------------------------------

function asPage(scope: Scope): Page {
  // Page and FrameLocator both expose getBy* / locator. We only rely on those,
  // so a widened structural type is fine for our usage.
  return scope as unknown as Page;
}
function asScope(scope: Scope): Locator {
  return scope as unknown as Locator;
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
