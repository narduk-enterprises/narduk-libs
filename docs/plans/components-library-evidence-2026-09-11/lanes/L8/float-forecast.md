# float-forecast — component-usage survey (lane L8)

SHA `bfaad6d1` (main). App dir: `apps/web` (62 .vue files: 46 components, 12
pages, 2 layouts, app.vue, error.vue). **Legacy template layer** consumer:
`narduk-nuxt-template-layer-{core,seo,analytics,maps,uploads,testing} @^1.18.x`,
plus one real narduk-libs package, `narduk-charts@^2.1.0`. No direct `@nuxt/ui`
dependency (inherited from the core layer, not verified without install — no
`pnpm install` per ground rules).

## Most reusable hand-rolled things (path, LOC, consumers, what a shared version needs)

1. `apps/web/app/components/consumer/saved/SavedRiversPanel.vue` — 106 LOC, 1
   consumer (`ConsumerSavedPage.vue`). Lines 86-93: hand-rolled "No favorites
   yet" empty state (dashed border, heading, copy, CTA button) — a clean
   `AppEmptyState` duplicate. A shared version needs: icon/illustration slot,
   heading, body copy, one CTA link.
2. River-detail tile-grid family — `RiverDetailStatsGrid.vue` (38 LOC),
   `RiverDetailForecastBringGrid.vue` (48), `RiverDetailRouteLogisticsGrid.vue`
   (70), `RiverDetailSafetyAlertsGrid.vue` (51) — 207 LOC total, 4 separate
   hand-rolled components sharing one tile-grid shape. A shared KPI/stat-tile
   primitive with per-item slots would collapse these.
3. `apps/web/app/components/outlook/OutlookErrorCard.vue` — 25 LOC. Wraps Nuxt
   UI `UAlert` as a reusable error card. **0 production consumers found** via
   `<OutlookErrorCard` tag search (only its own component test,
   `tests/component/OutlookDayCard.test.ts`, references the sibling
   `OutlookDayCard`) — verify before treating as live.
4. `apps/web/app/components/outlook/OutlookStrip.vue` — 121 LOC. Horizontal
   day-by-day outlook strip; domain-specific, no narduk-libs sibling exists
   today.
5. `apps/web/app/components/consumer/ScoreRing.vue` — 52 LOC, 2 consumers.
   Circular floatability-score gauge; closer to a chart primitive than a status
   chip.
6. `apps/web/app/components/consumer/BottomTabBar.vue` +
   `ConsumerShellHeader.vue` — custom mobile nav/shell, not narduk-core's
   `LayerAppHeader`/`AppTabs` (different purpose: page-level nav vs in-page
   tabs).
7. `apps/web/app/components/consumer/ConsumerConditionGrid.vue` (73 LOC) and
   `RiverSpotCard.vue` — **0 production consumers found** via tag search;
   flagged, not confirmed dead (dynamic resolution unchecked).

## Table story

None. `grep -rlnE '<UTable|<table|role="table"' apps/web/app --include='*.vue'`
returned zero hits — all list-shaped data (rivers, guides, saved rivers) renders
as card/tile grids, never rows. The one genuine pagination CONTRACT in the repo,
`apps/web/server/api/users.get.ts`, is a zod-validated `page`/`limit` (max 100)
admin-users endpoint returning `{ users, total, page, limit }` — but **no local
`.vue` in `apps/web` calls it**; it feeds the legacy template layer's own admin
panel (not visible in this app's source without `pnpm install`, which ground
rules prohibit). It's good precedent evidence for the shared table's server
contract even though this app has no local table UI to migrate.

## What has broken (evidence: `gh issue/pr list --repo narduk-enterprises/float-forecast`)

- PR #16 "Fix mobile overflow in Float Forecast panels" (merged).
- PR #14 "Fix mobile zoom and scroll behavior" (merged).
- PR #15 "Add mobile viewport and improve touch/zoom behavior for inputs and
  map" (closed).
- No table/pagination/sort issues — consistent with having no table UI.

## Surprise

The only real page/limit pagination contract in the repo has zero local UI
consumers — it exists purely to serve the legacy layer's own admin panel, which
this survey cannot see without installing dependencies.
