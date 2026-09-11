# hydrogen — component-usage survey (L6)

SHA `ef6b8c0` on `main`. Two-part repo: `web/` is the Nuxt 4 app surveyed here
(Nuxt UI 4.9, narduk-core/analytics/seo installed); root `src/` is the actual
Cloudflare Worker/data API, proxied through `web/server/api/[...path].ts`. No
`layouts/` directory. No table/mobile/sort defects in issue or PR history.

## The table story

One table component: `web/app/components/SimpleTable.vue` (54 loc), a thin typed
wrapper around Nuxt UI's `<UTable>` — `columns`/`rows`/`rowKey` props, per-cell
named slots. 8 consumers (7 pages + `RollupRegionTable.vue`, a pre-configured
instance with region links and money-formatted cells). This is the cleanest,
smallest table implementation found in the lane: it delegates DOM/a11y entirely
to Nuxt UI rather than hand-rolling a `<table>`, unlike operator-portal's
`CollectionTable.vue`.

What it lacks: no sort, no pagination, no search — `UTable`'s own
`v-model:sorting`/`v-model:pagination` props are not forwarded at all, so it's a
pure static-display wrapper. Data comes from range-keyed cached JSON payloads or
one bounded endpoint (`GET /api/snapshots?limit=N`, clamped 1-500 default 100,
`src/router.ts:65` + `src/public-data.ts:48` — a bound SQL `LIMIT`, not true
pagination). Mobile responsiveness is unverified — no breakpoint CSS found in
`SimpleTable.vue` itself, so it likely inherits whatever Nuxt UI's own `UTable`
does by default.

Testing: one e2e spec (`tests/e2e/nuxt-pages.spec.ts`, 229 loc) does generic
hydration/marker-text smoke checks across all pages, including the table-bearing
ones — but has no table-specific sort/paginate/mobile assertions, a real gap
relative to operator-portal's dedicated coverage.

A shared table adopted here would need: the same thin UTable-adapter shape (this
app already proves that's viable and low-LOC), real sort/pagination wiring
(currently absent), and money/link cell formatting as a first-class slot pattern
(already exercised by `RollupRegionTable`).

## Other reusable things this app hand-rolls (path / LOC / consumers)

1. `web/app/components/DataState.vue` — 25 loc, **10 consumers** (highest reuse
   here). One `type: loading|error|empty` prop wrapping Nuxt UI's `UAlert` —
   unifies three states other repos split across multiple components. Plausibly
   overlaps `AppEmptyState`; not prop-compared.
2. `web/app/components/PageHeader.vue` — 23 loc, 9 consumers.
3. `web/app/components/InventoryHistoryChart.vue` — **277 loc**, 1 consumer.
   Hand-rolled inline `<svg>` chart (line 206) — narduk-charts is not even a
   dependency of this app despite the catalog offering
   `NardukLineChart`/`NardukHistogramChart`. Largest single hand-rolled surface
   in the repo.
4. `web/app/components/MetricTile.vue` — 23 loc, 6 consumers;
   `RollupMetricGrid.vue` (19 loc) composes 4 of them in a `grid-cols-4` KPI
   band. Plausibly overlaps narduk-ui's `NsReadoutTile`.
5. `web/app/components/StatusBadge.vue` — 24 loc, 4 consumers.
6. `web/app/components/AppPanel.vue` — 18 loc, 3 consumers — title+description
   section wrapper.
7. `web/app/components/ReportRangeSwitcher.vue` (25 loc, 6 consumers) and
   `RollupPeriodNav.vue` (23 loc, 2 consumers) — URL-link-based range/period
   switchers, same shape duplicated twice.
8. `web/app/components/StationMapSidebar.vue` (73 loc, 1 consumer) — despite the
   name, a searchable station **list**, not a map: no
   maplibre/mapbox/leaflet/`AppMapKit` anywhere in this app, and
   narduk-mapkit-nuxt isn't a dependency.
9. `web/app/components/StationList.vue` (27 loc) — **0 consumers** by tag-grep
   (plain and kebab-case checked) — appears dead/unused; flagged, not touched
   (read-only survey).

## What has broken

Searched issues/PRs for table/pagination/sort/overflow/mobile/hydration/empty —
found nothing table-UI-specific. The two loosely-relevant hits: #54 (closed) —
production 404 page server-rendered empty due to a wrangler bundling gap; #32
(open) — a data-plane thinning plan (Worker → narduk-data), not a UI defect.

## Counts

vue_files_total 25, components 14, pages 10, layouts 0, composables 1. Commands
in JSON `counts.commands`.
