# gonogo — component-usage survey (lane L8)

SHA `d73b8acf` (main). **Architecture finding (this is what the brief flagged —
"find where its .vue components actually live"): they mostly don't exist.** Only
2 `.vue` files in the whole repo: `app.vue` (`<UApp><NuxtPage /></UApp>`) and
`pages/[...slug].vue`, a catch-all whose entire template is `<div id="app" />`.
The real UI is a pre-existing vanilla-DOM/TypeScript client under `src/client/`
(44 `.ts` files, **13,101 LOC total**), self-mounted by
`plugins/gonogo-shell.client.ts` (`onNuxtReady` → dynamic
`import('../src/client/main')` → `client.renderCurrentLocation()`, wired only to
the Nuxt router for navigation events).

narduk-libs is **actually installed at current versions** —
`narduk-core@1.23.2`, `narduk-analytics@1.19.33`, `narduk-seo@2.0.10`,
`narduk-mapkit-nuxt@2.0.4`, `narduk-mapkit@2.0.2` — registered as Nuxt modules
in `nuxt.config.ts` (lines 23-28). But they're consumed for **infrastructure**
(SEO meta/sitemap, the `/api/mapkit-token` route, analytics loader), never for
their Vue components: there is no Vue component tree for
`AppBreadcrumbs`/`AdminAnalyticsDashboard`/etc. to be placed into.

## Most reusable hand-rolled things (path, LOC, consumers) — all non-Vue TypeScript renderers

1. `src/client/app/pages/calendar/view.ts` — 243 LOC, 1 consumer. Pure
   model-in/HTML-string-out renderer. Deliberately real `<table>` for the
   weekday grid "so a screen reader announces the weekday column" (module doc,
   lines 1-14); day cells are `<button aria-expanded>`, not links.
2. `src/client/app/pages/day/view.ts` — 418 LOC, 1 consumer. A second real
   `<table>` (lines 140-153: `<thead>` with `scope="col"`
   Gate/Limit/Value/Result, body rows with `scope="row"`) for a per-day
   safety-gate breakdown, plus a `<ul class="gg-day__checklist">` source-check
   list.
3. `src/client/app/shell.ts` — 301 LOC, 1 consumer. Hand-rolled app chrome —
   notably NOT narduk-core's `LayerAppShell`/`LayerAppHeader`, despite
   narduk-core being a real dependency here.
4. `src/client/app/sidenav.ts` — 276 LOC, 1 consumer. Hand-rolled side nav.
5. `src/client/map/` (engine.ts, page.ts, grid.ts, and siblings) — custom map
   module; the app does depend on narduk-mapkit-nuxt 2.0.4 but whether this
   directory routes through `AppMapKit` was not confirmed (read-only budget;
   would need a deeper trace).

## Table story

Two real hand-rolled tables, **both non-Vue**: the calendar week-span grid and
the day gate-breakdown table (see above). Both are small, fixed-size, no
sort/paginate/search, but genuinely more accessible (`scope` attributes,
`aria-expanded`) than most Vue "raw-table"/"grid-div" patterns seen elsewhere in
this survey. A Vue-based shared table component **cannot be dropped into gonogo
as-is** — these two screens would need either a Vue rewrite or a
non-Vue-consumable build of the shared table. `grep` found no `page`/`limit`/
`cursor` list contract anywhere in `src/worker/api`.

## What has broken (evidence: `gh issue/pr list --repo narduk-enterprises/gonogo`)

- PR #32 "Rebuild the Calendar screen on a week-aligned span grid" (merged) —
  the calendar table's own history.
- PR #24 "Wave 3 polish: calendar mobile overflow fix; honest score display on
  missing sea-state" (closed).
- Issue #31 (open) "Serve observed history so the calendar's elapsed days can
  show what actually happened."
- Issue #44 (open) "Map rail is structurally over-subscribed: 620px of fixed
  content against a 660px cap" and PR #41 "fix(map): stop the rail crushing
  route and detail cards" (merged) — layout-overflow churn.

## Surprise

This is the architecture outlier of the lane: real, current-version narduk-libs
dependencies coexist with zero Vue-rendered UI. It's evidence that Nuxt-module
adoption (SEO/analytics/mapkit-token wiring) and Vue-component adoption are two
entirely separate axes — a repo can score 100% on the first and 0% on the
second. Treat gonogo as a migration-prerequisite case for the shared table, not
a component-swap case.
