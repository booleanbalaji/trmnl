# TRMNL Project Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a Node/TypeScript project for building TRMNL Private Plugins (screens), deployed to Vercel, with one example "hello-world" screen and TRMNL's MCP server wired in for live markup editing.

**Architecture:** Plain Vercel serverless functions under `api/` (one per plugin) return JSON for TRMNL's Polling strategy. Markup/settings for each plugin live in TRMNL's dashboard and are edited via TRMNL's hosted MCP server (`https://trmnl.com/mcp`), configured through `.mcp.json`. A version-controlled copy of each plugin's markup lives under `plugins/<name>/`.

**Tech Stack:** TypeScript, `@vercel/node` types, Vercel CLI (dev/deploy), no test framework, no build framework beyond Vercel's built-in TS compilation for `api/*.ts`.

## Global Constraints

- Private Plugins only, official TRMNL cloud — no BYOS/self-hosted device firmware.
- Polling strategy only — no webhook data delivery.
- No `trmnlp` CLI, no Ruby, no Docker — explicitly declined during design.
- No automated test framework — plugin functions are thin JSON responders; verification is `tsc --noEmit` for type safety plus manual `curl` against a running/deployed endpoint.
- Plain Vercel functions — no Next.js or other web framework.
- Each TRMNL MCP API key is scoped to exactly one plugin.
- Full design context: `docs/superpowers/specs/2026-07-18-trmnl-plugin-project-design.md`.

---

### Task 1: Project scaffolding + hello-world endpoint

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `api/hello-world.ts`

**Interfaces:**
- Produces: `api/hello-world.ts` default-exports a function `handler(req: VercelRequest, res: VercelResponse)` that responds with JSON `{ greeting: string, current_time: string }`. Later tasks (3, 4) reference this endpoint by path `api/hello-world.ts` and its response shape.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "trmnl",
  "private": true,
  "version": "1.0.0",
  "description": "Screens and plugins for a personal TRMNL e-ink display",
  "scripts": {
    "dev": "vercel dev",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install -D typescript @types/node @vercel/node vercel`

Expected: `package.json` gains a `devDependencies` block with resolved versions, `package-lock.json` and `node_modules/` are created.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["api/**/*.ts"]
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
.vercel/
trmnl.env
.DS_Store
*.log
```

- [ ] **Step 5: Create `api/hello-world.ts`**

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    greeting: 'Hello from TRMNL!',
    current_time: new Date().toISOString(),
  });
}
```

- [ ] **Step 6: Type-check**

Run: `npm run typecheck`

Expected: exits with no output and status code 0 (no type errors).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore api/hello-world.ts
git commit -m "Scaffold project and add hello-world plugin endpoint"
```

---

### Task 2: Project CLAUDE.md with TRMNL rendering conventions

**Files:**
- Create: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing from other tasks — pure documentation.
- Produces: `CLAUDE.md` at repo root, referenced by future sessions for TRMNL-specific layout/typography rules. No code interface.

- [ ] **Step 1: Create `CLAUDE.md`**

```markdown
# CLAUDE.md

This repo builds Private Plugins ("screens") for a personal TRMNL e-ink display, connected to TRMNL's official cloud (not self-hosted).

## Architecture

- Each screen has two parts: **data** (a Vercel serverless function under `api/<name>.ts` returning JSON) and **markup** (a Liquid template, edited via TRMNL's MCP server, rendered by TRMNL into a PNG for the device).
- Plugins use the **Polling strategy**: TRMNL calls the deployed `api/<name>` endpoint on a schedule.
- Full design and plugin lifecycle: `docs/superpowers/specs/2026-07-18-trmnl-plugin-project-design.md`.

## Rendering conventions

Screens are captured server-side from a fixed container, not a browser viewport:

- Never use `vw`/`vh` units or `position: fixed` — use `%`-based sizing with flexbox instead.
- Framework layout hierarchy: Screen → View → Layout. Proven pattern for the view root:
  ```css
  .view { height: 100%; width: 100%; display: flex; flex-direction: column; overflow: hidden; position: relative; }
  .content-container { flex: 1; display: flex; overflow: hidden; min-height: 0; width: 100%; }
  .title_bar { flex-shrink: 0; }
  ```
- Typography components are purpose-specific — don't mix classes across them:
  - `title` / `title--small` — headings (sizes: small, base, large, xlarge, xxlarge)
  - `description` / `description--large` — paragraph/body text
  - `value` / `value--xsmall` — numerical data only, not prose
  - `label` — short tags/labels (variants: outline, underline, inverted)
- `no_screen_padding: 'yes'` in a plugin's settings removes framework padding for full-bleed content.

## Dev docs

- Webhooks: https://docs.trmnl.com/go/private-plugins/webhooks
- Screen templating: https://docs.trmnl.com/go/private-plugins/templates
- UI framework docs: https://trmnl.com/framework/docs
- UI framework examples: https://trmnl.com/framework/examples
```

- [ ] **Step 2: Verify required sections are present**

Run: `grep -c "^## " CLAUDE.md`

Expected: `3` (Architecture, Rendering conventions, Dev docs — confirms all three `##` sections exist).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Add project CLAUDE.md with TRMNL rendering conventions"
```

---

### Task 3: TRMNL MCP wiring + hello-world plugin markup

**Files:**
- Create: `.mcp.json`
- Create: `trmnl.env.example`
- Create: `plugins/hello-world/markup.liquid`
- Create: `plugins/hello-world/README.md`

**Interfaces:**
- Consumes: `api/hello-world.ts`'s response shape from Task 1 (`{ greeting, current_time }`) — the Liquid markup references these as template variables.
- Produces: `.mcp.json` config expecting `TRMNL_MCP_API_KEY` in the environment; `plugins/hello-world/markup.liquid` as the reference copy of the plugin's Liquid template.

- [ ] **Step 1: Create `.mcp.json`**

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

- [ ] **Step 2: Verify `.mcp.json` is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('.mcp.json', 'utf8')); console.log('valid')"`

Expected: `valid`

- [ ] **Step 3: Create `trmnl.env.example`**

```
TRMNL_MCP_API_KEY=ps_mcp_your_key_here
```

- [ ] **Step 4: Create `plugins/hello-world/markup.liquid`**

```liquid
<div class="view">
  <div class="content-container">
    <span class="title title--large">{{ greeting }}</span>
    <span class="value value--large">{{ current_time }}</span>
  </div>
</div>
```

- [ ] **Step 5: Create `plugins/hello-world/README.md`**

```markdown
# hello-world

Minimal screen proving the pipeline end-to-end: deploy → TRMNL polls → renders.

- **Data source:** `api/hello-world.ts`, deployed at `https://<vercel-project>.vercel.app/api/hello-world`
- **Strategy:** Polling
- **Dashboard plugin:** not yet created — see "Adding a new screen" in the root README
- **markup.liquid** here is a version-controlled copy; the dashboard's Edit Markup is the actual source TRMNL renders from, once the plugin exists and this markup has been pushed via MCP.
```

- [ ] **Step 6: Commit**

```bash
git add .mcp.json trmnl.env.example plugins/hello-world/markup.liquid plugins/hello-world/README.md
git commit -m "Wire up TRMNL MCP config and hello-world plugin markup"
```

---

### Task 4: Root README with setup and add-a-screen workflow

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the `npm run dev` / `npm run typecheck` scripts from Task 1, the MCP workflow from Task 3.
- Produces: top-level project documentation. No code interface.

- [ ] **Step 1: Create `README.md`**

```markdown
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
```

- [ ] **Step 2: Verify workflow section is present**

Run: `grep -c "^## Adding a new screen" README.md`

Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Add project README with setup and add-a-screen workflow"
```

---

## Post-plan (not automated — requires explicit go-ahead)

The tasks above produce a complete, locally-verified project. Two things are deliberately **not** part of this plan because they create external, visible resources and need explicit confirmation at the time they happen:

1. **Push `main` to `github.com/booleanbalaji/trmnl`** (remote is already configured).
2. **Connect the repo to a Vercel project** (using the Vercel MCP tools already available in-session) so `api/hello-world.ts` gets a live URL, then `curl` that URL to confirm it returns `{ greeting, current_time }`.

Do these in the main session after this plan's tasks are committed, asking the user before pushing and before creating the Vercel project.
