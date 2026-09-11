# narduk-enterprises/buoys — component survey (L1)

SHA `b87206b` (main). Nuxt 4.4.8. No direct `@nuxt/ui` dep but transitive access
via `@narduk-enterprises/narduk-core` (`nuxt.config.ts:99`). `reka-ui` 2.9.2 is
a **direct** dependency, used only for `ConfigProvider`/`TooltipProvider` in
`apps/web/app/app.vue` — independent of the Nuxt UI access that comes through
narduk-core. narduk-ui, narduk-charts, narduk-mapkit-nuxt, narduk-seo,
narduk-analytics, narduk-platform present; no narduk-auth, no legacy
template-layer. Largest, richest table/list evidence of the three L1 repos: 53
Vue files / 36 components.

## Most reusable hand-rolled things

1. **MarineStationList family** —
   `apps/web/app/components/marine/StationList.vue` (68 LOC) +
   `StationListCardItem.vue` (42) + `StationListCompactItem.vue` (83) +
   `StationListRowItem.vue` (70) + `StationListEmptyState.vue` (7) = **335 LOC
   across 5 files, 4 consumers**. A single `variant: 'cards'|'compact'|'rows'`
   prop switches render mode (region page uses `cards`, map sidebar and
   station-detail "Nearby Stations" use `compact`, default is `rows`), plus a
   client-side `limit` prop that does `Array.slice(0, limit)` — a display cap,
   **not real pagination**. This is the richest "what should a shared collection
   component's density modes look like" evidence in the whole lane.
2. **StationHistoryTable** —
   `apps/web/app/components/marine/StationHistoryTable.vue` (48 LOC, 1
   consumer). Hand-rolled CSS-grid history table: dynamic column count (one per
   available metric), `overflow-x-auto` for mobile, header row + data rows via a
   computed `tableGridStyle`. No sort, no search, no pagination — see Table
   story.
3. **StationListRowItem** —
   `apps/web/app/components/marine/StationListRowItem.vue` (70 LOC, 4 consumers
   via StationList). The closest thing to a real table row in the app: status
   dot + id/name/region on the left, 3 metric readings on the right, rendered as
   a `<ULink>` grid row, not a `<tr>`.
4. **MapSidebarFilters** —
   `apps/web/app/components/marine/MapSidebarFilters.vue` (143 LOC, 1 consumer).
   Largest hand-rolled filter surface across all three L1 repos; tested by
   `tests/server/marine-map-sidebar.test.ts` and
   `tests/e2e/map-sidebar.spec.ts`.
5. **StationSearchPanel** —
   `apps/web/app/components/marine/StationSearchPanel.vue` (72 LOC, 1 consumer).
   Search input feeding `MarineStationList` (rows, capped to 8 results).
6. **StationHistoryControls** —
   `apps/web/app/components/marine/StationHistoryControls.vue` (86 LOC, 1
   consumer). Unit-system (imperial/metric) + time-mode (local/UTC) toggles, a
   product selector, and an inline `UAlert` error state for the history table —
   no sort/pagination controls exist because none of this data is sorted or
   paged.
7. **RegionStatsPanel** — `apps/web/app/components/marine/RegionStatsPanel.vue`
   (41 LOC, 1 consumer). Icon+label+value+unit+trend KPI tiles. **Contains a
   literal, non-reactive `"2 min ago"` string with no template binding** — looks
   hardcoded rather than computed; flagged as a possible bug, not confirmed
   live.
8. **StationMetricsGrid** —
   `apps/web/app/components/marine/StationMetricsGrid.vue` (122 LOC, 1
   consumer). Largest KPI-tile-family component in the lane; not read in full.
9. **StationHistoryAvailability** —
   `apps/web/app/components/marine/StationHistoryAvailability.vue` (35 LOC, 1
   consumer). Per-period data-provenance cards (status, row count, source link,
   R2 key) describing the history table's own data completeness.
10. `useStationHistoryFormatters.ts` composable
    (`apps/web/app/composables/useStationHistoryFormatters.ts`) — drives both
    `StationHistoryTable`'s row labels and `StationHistoryControls`' local/UTC
    formatting.

## Table story

**StationHistoryTable**
(`apps/web/app/components/marine/StationHistoryTable.vue`) is the most
table-like surface in lane L1:

- **Kind**: CSS-grid header+rows (`grid-div`), dynamic column count =
  `1 + availableMetrics.length`.
- **Server contract**: `server/api/ndbc/stations/[stationId]/history.get.ts`
  takes `from`/`to`/`limit` (max 2000, default 500)/`product`/`resolution`
  (`raw|hourly|daily`) — a max-rows cap plus time-range/resolution selection
  **instead of** pagination. `limit_enforced: true`.
- **No sort, no search, no pagination, no row links.**
- **Mobile**: `overflow-x-auto` horizontal scroll on the outer wrapper — a real,
  deliberate mobile strategy, unlike riverstatus/lakestat-us where mobile
  handling wasn't measured.
- **States**: loading and error present (via parent `StationHistoryControls`'
  `pending`/`loadError` props feeding a `UAlert`); no explicit empty state on
  the table itself.
- Tested indirectly by `apps/web/tests/server/buoy-status-product.test.ts` (the
  query-schema/response logic behind it); no dedicated component test found.

**MarineStationList**'s `rows` variant (`StationListRowItem.vue`) is the second
table-shaped surface — same underlying station data, no pagination (client-side
`limit` slice only), no sort, no search (search lives in the separate
`StationSearchPanel`/`MapSidebarFilters`). The companion server contract,
`server/api/stations/index.get.ts`, takes `q`/`region`/`freshness`/`limit` (max
2000, default 1500) and returns `{ data, meta: { source, count, query } }` —
also capped, not paginated.

**What a shared table/collection component needs to cover here**: a genuine
multi-density mode switch (cards/compact/rows) driven by a prop rather than
viewport, a "capped, not paginated" mode for bounded datasets, dynamic/variable
column counts for time-series data, and horizontal-scroll as the mobile fallback
for wide tables.

## What's broken (issues/PRs, UI-relevant only)

- PR **#6** "Polish station charts and responsive map UI" (merged) — touches the
  chart/map surfaces directly.
- PR **#7** "Fix map annotation detail navigation" (merged).
- PR **#8** "90-day D1 history retention + stop history regrowth" (merged) —
  data-volume bound on the exact history table's backing store.
- Issue **#18** "Enable the e2e job in CI once @playwright/test is exactly
  pinned" (open) — CI infra, not UI behavior; excluded from the list above.

Tests touching these patterns:
`apps/web/tests/server/buoy-status-product.test.ts`,
`apps/web/tests/server/marine-map-sidebar.test.ts`,
`apps/web/tests/server/marine-models.test.ts`,
`apps/web/tests/e2e/map-sidebar.spec.ts`.

## Surprise

Despite being the freshest-adopting repo for narduk-charts (`Sparkline.vue` and
`StationHistoryChart.vue` both correctly wrap `NardukLineChart`) and
narduk-mapkit-nuxt (`AppMapKit`), buoys has **zero** usage of any narduk-ui
instrument (`NsFreshnessChip`/`NsLevelWell`/`NsRangeBar`/`NsReadoutTile` all 0)
despite being a freshness-heavy marine-status product — status is instead
conveyed via hand-rolled `.marine-dot` color classes (`dotClass()` in
`StationListRowItem.vue`).
