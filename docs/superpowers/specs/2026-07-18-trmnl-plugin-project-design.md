# TRMNL Plugin Project — Design

## Purpose

Set up this repo (`github.com/booleanbalaji/trmnl`) as the home for building custom screens ("Private Plugins") for a personally-owned TRMNL e-ink display, connected to TRMNL's official cloud (not self-hosted/BYOS).

## How TRMNL Private Plugins work

- A Private Plugin has two parts: **data** (JSON your server provides) and **markup** (a Liquid template, edited in TRMNL's web dashboard, that TRMNL's server renders into a PNG for the device).
- This project uses the **Polling strategy**: TRMNL's cloud calls a URL we control on a schedule and expects JSON back. (Alternative is Webhooks, where we push data to TRMNL — not used here since polling fits a stateless Vercel function better.)
- There is no public REST API to create/update plugins or push markup — the dashboard UI is normally the only way, **except** via TRMNL's MCP server (see below), which is what makes markup editable from this repo/session at all.

## Architecture

One Node/TypeScript project, deployed to Vercel, exposing one serverless function per plugin under `api/`. TRMNL's polling URL for each plugin points at that function's deployed URL. Markup/settings for each plugin are edited live via TRMNL's MCP server rather than pasted manually into the dashboard.

```
trmnl/
  .mcp.json                   # TRMNL MCP server config (reads TRMNL_MCP_API_KEY from env)
  trmnl.env.example           # placeholder; real trmnl.env is gitignored
  api/
    hello-world.ts            # one Vercel serverless function per plugin
  plugins/
    hello-world/
      markup.liquid           # version-controlled copy of what's live in the TRMNL dashboard
      README.md                # plugin ID / dashboard link / polling URL / notes
  package.json
  tsconfig.json
  CLAUDE.md                    # TRMNL-specific conventions for future sessions (see below)
  README.md                    # project setup + "how to add a new screen" workflow
```

## MCP integration

TRMNL exposes a hosted MCP server at `https://trmnl.com/mcp?api_key=${TRMNL_MCP_API_KEY}`. Each API key (`ps_mcp_*`) is scoped to **one plugin**, generated from that plugin's settings page in the dashboard after it's created and saved. `.mcp.json` wires this in:

```json
{
  "mcpServers": {
    "trmnl": {
      "type": "http",
      "url": "https://trmnl.com/mcp?api_key=${TRMNL_MCP_API_KEY}"
    }
  }
}
```

`TRMNL_MCP_API_KEY` lives in `trmnl.env` (gitignored), sourced into the environment before starting a Claude Code session. Since the key is per-plugin, switching which plugin is being worked on means swapping the key and restarting the session — this is an accepted friction, not something we're building tooling around.

## Plugin lifecycle (repeated for each new screen)

1. **Data logic**: write `api/<name>.ts` (plain Vercel serverless function, returns JSON). Push to `main` — the repo is connected to Vercel for auto-deploy.
2. **Create the plugin shell**: in TRMNL's dashboard (Private Plugins → New), set strategy = Polling, polling URL = the deployed `api/<name>` endpoint.
3. **Generate its MCP key**: from the plugin's settings page, copy the key into `trmnl.env`, restart the session.
4. **Build the screen**: use TRMNL's MCP tools (available once the key is set) to write/edit Liquid markup and settings (custom fields, `no_screen_padding`, dark mode, etc.), and trigger data refreshes to iterate.
5. **Sync back to git**: once markup settles, pull it via MCP and write it to `plugins/<name>/markup.liquid` so there's a version-controlled record (the dashboard remains the actual source of truth TRMNL renders from).

## Example plugin: hello-world

A minimal screen proving the whole pipeline end-to-end: `api/hello-world.ts` returns `{ greeting, current_time }`; the Liquid markup displays them using the TRMNL framework's `title` and `value` typography components. Exists to validate deploy → poll → render before building anything real.

## Tooling decisions (and why)

- **No `trmnlp` CLI** — explicitly declined (avoids a Ruby/Docker dependency); MCP covers the same need (live markup editing) without extra local runtime.
- **No BYOS/self-hosting** — device stays on TRMNL's cloud; less infrastructure to own.
- **No test framework** — plugins are thin JSON-returning functions; verification is `vercel dev` + curl locally, and MCP-triggered refreshes against the live template. Not enough logic here to justify a formal suite; revisit if a plugin grows real logic.
- **Plain Vercel functions, not Next.js** — avoids pulling in a full framework for what's just small API handlers.
- **Deploy via GitHub→Vercel integration** (not manual `vercel --prod`) — repo is already the source of truth; push-to-deploy keeps the loop simple.

## Project CLAUDE.md contents

Seeded with TRMNL-specific rendering conventions confirmed against a mature reference implementation (`lanrat/trmnl_plugins`), so future sessions don't have to relearn them:
- Screens are captured server-side from a fixed container, not a browser viewport — never use `vw`/`vh`/`position: fixed`; use `%`-based sizing + flexbox.
- Framework layout hierarchy: Screen → View → Layout; use the proven `.view` / `.content-container` / `.title_bar` flex pattern.
- Typography components (`title`, `description`, `value`, `label`) are purpose-specific — don't mix them.
- Links to TRMNL's dev docs (webhooks, templates, framework docs/examples).

## Out of scope

- Publishing to TRMNL's public plugin marketplace (private plugins only).
- BYOS/self-hosted device firmware.
- Any plugin-specific screen ideas beyond the hello-world example — those come later, one lifecycle loop at a time.
