# pnl — component-usage survey (L5)

SHA `4229aabb`, branch `main`. Clone ok.

## Stack

Not a Nuxt/Vue app, not even a frontend framework. `package.json` (repos root,
no `apps/`) depends only on `@cloudflare/workers-types`, `typescript`,
`wrangler`. `src/index.ts` (26 lines) is a bare Cloudflare Worker that serves
static assets from `public/` via `env.ASSETS.fetch`. `is_nuxt_app: false`.

## Table/list UI

- `public/docs/index.html` (2570 lines) — a hand-authored HTML rendering of
  `public/docs/Pricing_Intelligence_Middleware_Spec.md`. Contains ~21 static
  `<table>` tags (first at line 444, more through line 2534) and dozens of
  `<ul>/<li>` lists. These are spec-document tables (pricing tiers, comparison
  matrices) with hardcoded rows — no JS, no sort/paginate/search, no framework
  at all.
- `public/index.html` (311 lines) — the marketing landing page; one `<li>`
  (nav), no `<table>`.

## Verdict

Per brief instructions this repo gets the minimal survey only (no framework to
speak of, so deep Nuxt survey doesn't apply). `has_table_or_list_ui: true` in
the narrow sense that static HTML tables exist on the docs page, but there is
nothing here resembling the sortable/ paginated/searchable data-table pattern
the estate table component targets — no consumers, no server contract, no
interactivity. Nothing to extract; no defect history relevant to UI components
(this isn't an interactive app).

Evidence:
`public/docs/index.html:444,607,672,762,888,975,1160,1265,1346,1412,1492,1561,1641,1684,1771,1983,2109,2273,2319,2472,2534`;
`src/index.ts` (26 lines total); root `package.json`.
