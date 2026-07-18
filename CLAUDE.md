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
