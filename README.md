# trmnl

Screens and plugins for a personal TRMNL e-ink display, built as TRMNL Private Plugins (official cloud, not self-hosted).

## How it works

Each screen has two parts:
- **Data** — a Vercel serverless function under `api/<name>.ts` returning JSON, using TRMNL's Polling strategy (TRMNL calls this URL on a schedule).
- **Markup** — a Liquid template that TRMNL renders into a PNG for the device. Edited live via TRMNL's MCP server rather than pasted into the dashboard by hand.

See `docs/superpowers/specs/2026-07-18-trmnl-plugin-project-design.md` for the full design, and `CLAUDE.md` for TRMNL-specific rendering conventions.

## Setup

```bash
npm install
```

Copy `trmnl.env.example` to `trmnl.env` and fill in a plugin's MCP key (see "Adding a new screen" below for where that comes from). Source it before starting a session:

```bash
cp trmnl.env.example trmnl.env
set -a; source trmnl.env; set +a
```

## Adding a new screen

1. Write `api/<name>.ts` (a Vercel serverless function returning JSON). Push to `main` — the repo auto-deploys via the connected Vercel project.
2. In TRMNL's dashboard (Private Plugins → New), create the plugin: strategy = Polling, polling URL = the deployed `api/<name>` endpoint.
3. On the plugin's settings page, generate an MCP key. Put it in `trmnl.env` as `TRMNL_MCP_API_KEY`, then `set -a; source trmnl.env; set +a` and restart the Claude Code session.
4. With the MCP key active, edit the plugin's Liquid markup and settings directly through TRMNL's MCP tools, using data refreshes to iterate on the rendered screen.
5. Once the markup settles, pull it via MCP and save it to `plugins/<name>/markup.liquid` so the repo has a version-controlled record.

Each MCP key is scoped to one plugin — switching which screen you're working on means swapping the key and restarting the session.

## Local development

```bash
npm run dev
```

Requires `vercel login` once, and linking the project (`vercel link`) to the Vercel project this repo is connected to.
