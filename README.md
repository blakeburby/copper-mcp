# Copper CRM MCP Server — Playwright edition (unofficial)

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent (Claude
Desktop, Claude Code, or any MCP client) work with your [Copper CRM](https://copper.com)
by **driving the Copper web app in a real browser** — no API key required.

> **Unofficial.** Not affiliated with or endorsed by Copper. It automates the
> web UI as *you* would, using a browser session *you* authenticate. Because it
> depends on Copper's UI, it can break when that UI changes. Use at your own risk
> and within Copper's Terms of Service.


## Read-only by default

Two of the thirteen tools mutate Copper: `log_activity` (creates an activity)
and `create_task` (creates a task). Both are gated by `COPPER_READ_ONLY`, which
**defaults to `true`** — so out of the box the write tools are **not
registered** and no MCP client can call them. The startup log makes this
explicit either way:

    [info] Read-only mode: write tools are NOT registered.
    [warn] COPPER_READ_ONLY=false — write tools log_activity and create_task ARE registered.

Set `COPPER_READ_ONLY=false` only when you actually want writes. For a
production Copper account managing real revenue we recommend also authenticating
the persistent profile as a **read-only Copper user** — browser automation runs
with exactly the logged-in user's rights, so a read-only user makes the
guarantee structural rather than code-dependent.

Even with writes enabled, both tools remain **confirm-gated**: `confirm: false`
returns a preview and writes nothing.

## Why no API key?

Copper's REST API requires a developer API key, which is gated behind certain
paid plans. This server sidesteps that entirely: it logs into `app.copper.com`
through a normal browser session (password, Google SSO, or SSO — including MFA)
that **you** complete once, then reuses that session from a persistent browser
profile. There is:

- **no `COPPER_API_KEY`**
- **no Copper developer access**
- **no paid API upgrade**

…required. It only ever does what your authenticated Copper user can already do.

## How it works

```
MCP client (Claude) ──stdio──► copper-mcp ──Playwright──► Chromium ──► app.copper.com
                                    │
                                    └─ persistent profile (.copper-profile): your logged-in session
```

- A single **persistent Chromium context** holds your session and is reused
  across requests (never one browser per call).
- **Page objects** encapsulate how each screen is read/driven.
- **Selectors** are centralized with a primary + fallback each.
- Tools return **structured JSON** with a consistent success/error envelope.
- Writes are **confirm-gated** and verified; failures capture screenshots.

## Requirements

- Node.js ≥ 18
- macOS / Linux / Windows with a desktop (headed first-time login needs a display)

## Installation

```bash
npm install
npm run install:browsers   # downloads Chromium for Playwright
npm run build
```

## First-time authentication

The session is established interactively — the server never sees your credentials.

1. Ensure `COPPER_HEADLESS=false` (the default) so the window is visible.
2. From your MCP client, call the **`initialize_copper_session`** tool
   (or run the built server and invoke it). A Chromium window opens at
   `app.copper.com`.
3. Sign in normally — **Sign in with Google**, **Sign in with SSO**, or the
   email/password flow — and complete any MFA. The server waits (up to ~5
   minutes) and detects when you're in.
4. Your session is saved to the persistent profile directory
   (`COPPER_USER_DATA_DIR`, default `./.copper-profile`) and reused afterwards.

Check it any time with **`get_copper_session_status`**.

### Persistent profile behavior

The logged-in session lives entirely in `COPPER_USER_DATA_DIR`. Keep it private
(it is git-ignored). Delete that directory to fully sign out / reset (see
[Session reset](#session-reset)).

### Headed vs headless

- **First login must be headed** (`COPPER_HEADLESS=false`) so you can sign in.
- After the session is saved you can switch to **headless**
  (`COPPER_HEADLESS=true`) for day-to-day use. If the session expires, tools
  return `AUTHENTICATION_REQUIRED`; re-run `initialize_copper_session` headed.

## Configuration

All via environment variables (see [`.env.example`](.env.example)). **No
credentials are stored here.**

| Variable | Default | Purpose |
|---|---|---|
| `COPPER_BASE_URL` | `https://app.copper.com` | Copper web app base URL |
| `COPPER_USER_DATA_DIR` | `./.copper-profile` | Persistent browser profile (your session) |
| `COPPER_HEADLESS` | `false` | Run browser headless (`true`) or headed (`false`) |
| `COPPER_DEFAULT_TIMEOUT_MS` | `30000` | Per-action timeout |
| `COPPER_NAVIGATION_TIMEOUT_MS` | `45000` | Navigation timeout |
| `COPPER_SCREENSHOT_DIR` | `./artifacts/screenshots` | Failure screenshots / HTML snapshots |
| `LOG_LEVEL` | `info` | `error` \| `warn` \| `info` \| `debug` (all logs go to stderr) |

## Connecting to Claude Desktop

Edit `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "copper": {
      "command": "node",
      "args": ["/absolute/path/to/copper-mcp/dist/index.js"],
      "env": {
        "COPPER_HEADLESS": "false",
        "COPPER_USER_DATA_DIR": "/absolute/path/to/copper-mcp/.copper-profile"
      }
    }
  }
}
```

Restart Claude Desktop, then ask it to run `initialize_copper_session` and log in.

## Connecting to Claude Code

```bash
claude mcp add copper -- node /absolute/path/to/copper-mcp/dist/index.js
```

Or add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "copper": {
      "command": "node",
      "args": ["/absolute/path/to/copper-mcp/dist/index.js"],
      "env": { "COPPER_HEADLESS": "false" }
    }
  }
}
```

## Supported tools

### Session & diagnostics
| Tool | Type | Description |
|---|---|---|
| `initialize_copper_session` | setup | Open Copper headed and guide manual login; persist the session. |
| `get_copper_session_status` | read | Report browser running / authenticated / expired / page usable. |
| `capture_copper_diagnostics` | debug | Save a screenshot + sanitized HTML + URL/title of the current page. |

### Read
| Tool | Inputs | Returns |
|---|---|---|
| `search_people` | `query`, `limit` | People (id, name, record URL, best-effort fields) |
| `get_person` | `personId` | Person detail + activities + tags |
| `search_companies` | `query`, `limit` | Companies |
| `search_opportunities` | `query`, `pipeline?`, `stage?`, `owner?`, `status?`, `closeDateFrom?`, `closeDateTo?`, `limit` | Opportunities (filters applied best-effort) |
| `list_pipelines` | — | Pipelines and their stages |
| `get_opportunity` | `opportunityId` | Opportunity detail |

### Write (confirm-gated)
| Tool | Inputs | Behavior |
|---|---|---|
| `log_activity` | `parentType`, `parentId`, `activityType`, `details`, `confirm` | Appends a note/activity |
| `create_task` | `title`, `dueDate?`, `parentType`, `parentId`, `description?`, `confirm` | Creates a task |

### Write confirmation requirements

Both write tools default to **`confirm: false`**, which returns a **preview and
writes nothing**. To actually write, pass **`confirm: true`**. On a real write
the tool:

- holds a **mutation lock** (no two writes run at once),
- submits **exactly once**,
- **verifies** the record appears, and
- **never blindly retries** — if verification is inconclusive it returns
  `AMBIGUOUS_RESULT` telling you to check manually rather than risk a duplicate.
- `create_task` additionally **refuses a same-title duplicate** on the record.

## Response shape

Success:

```json
{
  "success": true,
  "message": "Found 3 people.",
  "data": { "people": [] },
  "meta": { "source": "copper-web-ui", "recordCount": 3 }
}
```

Error:

```json
{
  "success": false,
  "message": "Copper login is required.",
  "error": { "code": "AUTHENTICATION_REQUIRED", "details": "Run initialize_copper_session in headed mode." }
}
```

Error `code` is one of: `AUTHENTICATION_REQUIRED`, `RECORD_NOT_FOUND`,
`PERMISSION_DENIED`, `SELECTOR_FAILURE`, `NAVIGATION_FAILURE`, `AMBIGUOUS_RESULT`,
`VALIDATION_FAILURE`, `UNEXPECTED_UI`, `BROWSER_FAILURE`, `CONFIRMATION_REQUIRED`,
`UNKNOWN`.

## Selector fragility & the verified/unverified split

Copper's app UI is not a stable API. Selectors are centralized in
[`src/selectors/copperSelectors.ts`](src/selectors/copperSelectors.ts), each with
a **primary** and a **fallback**, and each tagged:

- `// VERIFIED <date>` — confirmed against the live Copper UI.
- `// UNVERIFIED` — a best-effort guess **not yet confirmed**. Tools relying on
  these may fail with `SELECTOR_FAILURE` until validated.

> **Status: validated live against a real Copper account on 2026-07-24**, with
> records created specifically to exercise the list and record-detail paths.
>
> Three findings shape the whole selector layer — Copper is an **Ember** app:
>
> 1. **`getByLabel` is unusable.** Copper's `<label>` elements carry no `for`
>    attribute and no aria association. Placeholders are the reliable handle.
> 2. **Element ids are generated** (`ember258`) and change every render.
> 3. **Record-detail values live in inline-editable `<input>` values, not text.**
>    Reading them needs `inputValue()` — `innerText()` silently returns empty.
>
> **VERIFIED:**
> - Login screen (`/users/sign_in`, email-first flow).
> - App-shell detection — account-scoped SPA at `/companies/{accountId}/app#/…`;
>   there is **no** `role="navigation"` element, so the global search box is the
>   signal.
> - Hash routing for people/companies/opportunities/tasks/feed.
> - Global search input and the quick-search empty state.
> - **List rows**: a populated list *is* an HTML `<table>` —
>   `tbody.ListViewTableBody > tr.et-tr`. Record links are `a.fullProfileLink`;
>   the clean name is in `span.AvatarPill_text` (the link text also contains the
>   avatar initial).
> - **Record view route**: `?fullProfile=people-<id>` on the list route
>   (`#/contact/<id>` redirects to it). There is no standalone record page.
> - **Record fields** by placeholder: `Add Name`, `Add Company`, `Add Title`,
>   `Add Owner`, `Add Email`, `Add Phone`.
> - **Person & task composers** (placeholders + the
>   `ModalFormFrameworkCreateEntity_saveButton`), the `Create New` menu, and the
>   typeahead option list (`.Typeahead_options li.js-optionItem`).
>
> **STILL UNVERIFIED** (the capture account had none of these): record **tags**,
> the **activity feed**, the **activity composer** (so `log_activity` is
> unverified end-to-end), **pipeline stages**, and the task **due-date** input
> (its placeholder is today's date, so it can't be matched literally). Tools
> relying on these may return `SELECTOR_FAILURE`; see the checklist below.

### Debugging selector failures

1. Run **`capture_copper_diagnostics`** — it saves a screenshot + sanitized HTML
   + the URL/title under `COPPER_SCREENSHOT_DIR`. The artifact path is also
   included in the `error` of any tool that fails on a selector.
2. Open the screenshot to see what the page actually shows.
3. Update the primary/fallback in `copperSelectors.ts`, flip the entry to
   `verified: true` with a dated comment, rebuild, and re-test.

## Manual live-validation checklist

Automated CI tests run against **local HTML fixtures** (no live Copper). Validate
the real UI manually:

- [ ] `initialize_copper_session` opens headed Chromium and detects login.
- [ ] `get_copper_session_status` reports `authenticated: true` after login.
- [ ] Confirm the authenticated landing path and update `routes.appHome` if needed.
- [ ] `search_people` returns rows with correct name + record URL. Adjust
      `globalSearch.input`, `list.rows`, `list.rowLink` as needed; mark verified.
- [ ] `get_person` extracts name and labeled fields. Adjust `recordDetail.*`.
- [ ] `search_companies` returns rows.
- [ ] `search_opportunities` returns rows; check filter behavior.
- [ ] `list_pipelines` lists pipelines + stages. Adjust `pipelines.*`.
- [ ] `log_activity` with `confirm:false` previews; with `confirm:true` writes and
      verifies. Adjust `activityComposer.*`.
- [ ] `create_task` likewise. Adjust `taskComposer.*`.

Record findings by flipping the relevant selector entries to `verified: true`.

## Session reset

```bash
rm -rf ./.copper-profile        # or your COPPER_USER_DATA_DIR
```

Then re-run `initialize_copper_session` and log in again.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `AUTHENTICATION_REQUIRED` | Session expired or never established. Run `initialize_copper_session` headed. |
| `SELECTOR_FAILURE` | UI changed or selector is UNVERIFIED. Use `capture_copper_diagnostics`, update selectors. |
| `NAVIGATION_FAILURE` | Network/slow page. Retries + backoff already applied; try again or raise timeouts. |
| `BROWSER_FAILURE` / "Did you run install:browsers" | Run `npm run install:browsers`. |
| `AMBIGUOUS_RESULT` on a write | The write may or may not have saved — **check manually**, do not blindly retry. |
| Nothing happens on first login | `COPPER_HEADLESS` must be `false` for the login window to appear. |

## Security

- Browser profiles, session data, cookies, screenshots, and `.env` are
  **git-ignored** and must never be committed.
- Logs go to **stderr** and are **sanitized** (cookies/tokens/passwords redacted).
- Diagnostics HTML snapshots blank out input values, password fields, and inline
  scripts. Cookies/storage state are **never** written to artifacts or returned
  through MCP responses.
- No Copper credentials or account data are hardcoded.
- Writes stay disabled unless you pass `confirm: true`.
- This tool makes **no attempt** to bypass CAPTCHA, MFA, SSO, permissions, or any
  Copper security control, and only automates actions available to your user.
- Browser automation may be affected by Copper UI changes and by Copper's Terms
  of Service — you are responsible for compliant use.

## Extending: adding a page object or tool

1. **Selectors** — add entries (primary + fallback + `verified`) to
   [`src/selectors/copperSelectors.ts`](src/selectors/copperSelectors.ts).
2. **Page object** — add a class in `src/pages/` extending `BasePage`; use
   `resolve()` / `tryResolve()` / `read()` and the collection helpers.
3. **Types** — add record shapes in `src/types/records.ts`.
4. **Schema** — reuse/extend Zod schemas in `src/schemas/common.ts`.
5. **Tool** — add `src/tools/<name>.ts` exporting `register<Name>(server)` that
   validates input, calls `requireAuthenticatedPage()`, and returns via
   `okResult()` / the `runTool()` wrapper. For writes, gate on `confirm` and run
   inside `getBrowserManager().withMutation(...)`.
6. **Register** it in `src/index.ts`.
7. **Tests** — add a Vitest unit test and, if useful, a fixture-backed Playwright
   spec under `src/tests/`.

## Test fixtures

`src/tests/e2e/fixtures/` holds local HTML pages that stand in for Copper so the
e2e specs run in CI with no live account. They are deliberately built to match
Copper's **real DOM shape**, not a convenient one:

- list views are **div-based** (no `<table>`, no `role="row"`) — so
  `getByRole("row")` misses here exactly as it does in production, and the
  fallback selector is what actually gets exercised;
- there is **no** `role="navigation"` element;
- links use account-scoped **hash routes** (`#/view/entity/person/1001`).

The CSS class names (`ListView_row`, `RecordDetail_label`, …) follow Copper's
observed `Component_element` convention but are **invented placeholders** — only
`GlobalSearchEmptyState` and the search placeholder text are verified. The
fixtures are styled to resemble Copper so you can open one in a browser while
debugging a selector.

> These fixtures test **our code against our assumptions**. Passing specs do
> *not* prove a selector matches real Copper — only the manual checklist above
> does that.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest unit tests
npm run test:e2e    # playwright fixture specs
npm run build       # compile to dist/
```

## License

MIT
