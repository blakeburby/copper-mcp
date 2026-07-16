# Copper CRM MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent (Claude
Desktop, or any MCP client) read your [Copper CRM](https://copper.com) and run
light pipeline hygiene — search deals, spot stale opportunities, log a note, and
schedule a follow-up.

> **Unofficial.** Built to show what an official Copper MCP server could look
> like. It's a focused, read-heavy demo — not a production integration.

## Why it looks the way it does

- **Read-heavy by design.** Six of the seven tools only read. Exactly one tool
  writes (`log_activity`), and even that only *appends* an activity — it can't
  edit or delete existing records. A deliberately small blast radius is the
  right security posture for letting an agent touch your CRM.
- **Descriptions written for an agent.** Each tool says what it returns and when
  to reach for it, so the model chains them correctly (e.g. call `list_pipelines`
  to turn a stage *name* into the IDs the other tools need).
- **Clean errors, not stack traces.** A bad key comes back as
  `Copper API returned 401 — check COPPER_API_KEY`, so the agent can explain the
  problem instead of choking on it.

## Install (3 steps)

```bash
git clone https://github.com/<your-username>/copper-mcp.git
cd copper-mcp
npm install && npm run build
```

Then add this block to your Claude Desktop config
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS),
and restart Claude Desktop:

```json
{
  "mcpServers": {
    "copper": {
      "command": "node",
      "args": ["/absolute/path/to/copper-mcp/dist/index.js"],
      "env": {
        "COPPER_API_KEY": "your_copper_api_key",
        "COPPER_USER_EMAIL": "you@yourcompany.com"
      }
    }
  }
}
```

Get your API key from Copper under **Settings → Integrations → API Keys**. The
`COPPER_USER_EMAIL` must be the email of the user who owns that key.

## Tools

| Tool | Reads / Writes | What it does |
|------|:---:|------|
| `search_people` | read | Find people by name or email. |
| `search_companies` | read | Find companies by name. |
| `search_opportunities` | read | List/filter deals by pipeline, stage, or assignee. |
| `list_pipelines` | read | Every pipeline and its stages — maps stage names → IDs. |
| `get_opportunity` | read | Full detail of one deal (custom fields, tags, contact). |
| `create_task` | write* | Schedule a follow-up task, optionally linked to a record. |
| `log_activity` | **write** | Append a note/call to a person, company, opportunity, or lead. |

\* `create_task` creates a new task record; it never modifies existing CRM data.
`log_activity` is the only tool that writes onto an existing record.

## Try it

Once it's wired into Claude Desktop, ask:

> "Which deals in my main pipeline are closing this month and have had no
> activity in the last 2 weeks? Log a note on the top one reminding me to send
> pricing, and create a follow-up task for Friday."

The agent calls `list_pipelines` → `search_opportunities` → `get_opportunity` to
triage, then `log_activity` + `create_task` to act.

## Configuration

Read from the environment (never hardcoded):

| Variable | Description |
|----------|-------------|
| `COPPER_API_KEY` | Your Copper API key. |
| `COPPER_USER_EMAIL` | Email of the key's owner. |

For local testing outside Claude Desktop, copy `.env.example` to `.env` and run
`COPPER_API_KEY=... COPPER_USER_EMAIL=... npm start`.

## Development

```bash
npm run build   # compile TypeScript → dist/
npm run dev     # tsc --watch
npm start       # run the built server on stdio
```

Layout: `src/copperClient.ts` is the single HTTP/auth/error layer; each tool
lives in its own file under `src/tools/`; `src/index.ts` registers them and
opens the stdio transport.

---

Built by **Hasan Khadra** — hasankhadra2013@gmail.com.

The official version ships with full OAuth 2.1, write coverage across the CRM,
and a two-week fixed-scope delivery.

## License

[MIT](./LICENSE)
