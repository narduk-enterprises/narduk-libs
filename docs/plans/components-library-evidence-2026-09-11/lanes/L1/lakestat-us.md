# narduk-enterprises/lakestat-us — component survey (L1)

SHA `b46c233` (main). Nuxt ^4.4.2, Tailwind 4, no direct `@nuxt/ui` dep but
transitive access via `@narduk-enterprises/narduk-core/nuxt`
(`apps/web/nuxt.config.ts:95`). narduk-ui and narduk-mapkit-nuxt present; **no
narduk-charts dependency at all** (absent from `package.json`, unlike
riverstatus). No narduk-auth, no legacy template-layer. Smallest app in the
lane: 32 Vue files / 17 components.

## Most reusable hand-rolled things

1. **The `/lakes` directory table** — `apps/web/app/pages/lakes/index.vue` (125
   LOC) + `apps/web/app/components/lakestat/LakeDirectoryRow.vue` (84 LOC, 1
   consumer). This is the real table in the lane: a `.directory-table` /
   `.directory-table__header` CSS-grid with an explicit 5-column header
   (Reservoir, Percent full, Elevation, Storage, Freshness), search (`UInput`) +
   region/availability filters (`USelect`) synced to `route.query`, row-links
   via `<ULink>`, and empty/loading/error states — but **zero sort control and
   zero pagination**. See Table story below.
2. **LevelGauge** — `apps/web/app/components/lakestat/LevelGauge.vue` (55 LOC, 4
   consumers). Percent-full fill+waterline gauge, horizontal/vertical
   orientation, null-safe "Not published" state. Textbook overlap with
   narduk-ui's `NsLevelWell`/`NsRangeBar` instruments — used right next to a
   correct `NsFreshnessChip` call in the very same consumer
   (`LakeDirectoryRow.vue`).
3. **PendingDataPanel** —
   `apps/web/app/components/lakestat/PendingDataPanel.vue` (28 LOC, 5
   consumers). Icon + label + title + description panel for "not part of the
   current published product" sections. Same conceptual slot as `AppEmptyState`
   (0 consumers app-wide).
4. **LakeHistoryChart** —
   `apps/web/app/components/lakestat/LakeHistoryChart.vue` (92 LOC, 1 consumer).
   Fully hand-rolled history chart — this repo has **no
   `@narduk-enterprises/narduk-charts` dependency at all**, so there's no
   `NardukLineChart` to even compose. Strongest chart-family gap in the lane.
5. **LakeCard** — `apps/web/app/components/lakestat/LakeCard.vue` (103 LOC, 4
   consumers). Lake summary card, correctly uses `NsFreshnessChip`.
6. **RecordCard** — `apps/web/app/components/lakestat/RecordCard.vue` (37 LOC, 1
   consumer). Almanac record card.
7. **PublicTopNav** — `apps/web/app/components/lakestat/PublicTopNav.vue` (70
   LOC, 1 consumer). App-specific nav shell; none of narduk-core's `Layer*`
   shells are used anywhere in this app.
8. Inline **page-header pattern** — `.atlas-page-header` class (kicker + h1 +
   description + status chip), reused by CSS class name across pages, never
   extracted into a component.
9. **MetricTile** — `apps/web/app/components/lakestat/MetricTile.vue` (82 LOC, 2
   consumers) — **not a gap**, already composes `NsReadoutTile` (line 49).
   Listed for completeness / as a positive adoption example.
10. `lakestat-format.ts` utils (`apps/web/app/utils/lakestat-format.ts`) —
    houses `formatNumber`, `formatMetricValue`, `formatObservationDate`; not
    split by concern.

## Table story

The `/lakes` directory (`apps/web/app/pages/lakes/index.vue`) is the cleanest
table-shaped surface found in lane L1:

- **Kind**: CSS-grid header+rows (`grid-div`), not `<table>` or `UTable`.
- **Server contract**: `server/api/lakes/directory.get.ts` takes
  `q`/`region`/`availability`/`state`, filters the full in-memory Texas-lake
  directory server-side, and returns **every match with no `limit`/`offset`/page
  at all** — `limit_enforced: false`. `server/api/lakes.get.ts` (a second,
  simpler endpoint) reads no query params whatsoever.
- **Columns (5)**: Reservoir (photo+name+link), Percent full (renders via the
  local `LevelGauge`), Elevation, Storage, Freshness (`NsFreshnessChip`).
- **States**: empty (`No published reservoirs match these filters`), loading
  (`pending` → "Loading the published directory…"), error (`.ls-banner.is-error`
  from `data.message`) — all three present, all three hand-rolled inline in the
  page, not shared components.
- **URL state**: `q`/`region`/`availability` all sync to `route.query` via
  `router.replace`.
- **No sort, no pagination**: the dataset (Texas reservoirs) is bounded enough
  that the team never built either. A shared table component aimed at this app
  needs to work well with zero rows _and_ with an unbounded, unpaged response —
  it can't assume the API always paginates.
- Sticky header: confirmed **false** (no `.directory-table` reference in
  `app/assets/css/theme.css`'s `sticky` rules — those apply to an unrelated map
  sidebar label).
- Mobile: not measured — no distinct mobile branch found in the template; CSS
  responsive behavior not inspected.
- Tested by `apps/web/tests/e2e/lakestat-directory.spec.ts`.

## What's broken (issues/PRs, UI-relevant only)

Issue search for table/pagination/sort/overflow/mobile/hydration/empty returned
**zero results** — much cleaner defect history than riverstatus. Only loosely
relevant: PR **#13** "[codex] Repair LakeStat UX and SEO crawl states" (merged).
PR **#43** "Adopt narduk-testkit's ui-quality module" (merged) is a
testing-tooling adoption, not a UI bug, excluded.

Tests touching these patterns: `apps/web/tests/e2e/lakestat-directory.spec.ts`,
`apps/web/tests/server/narduk-lake-data.test.ts`,
`apps/web/tests/server/narduk-lake-atlas-data.test.ts`,
`apps/web/tests/server/atlas-theme-contrast.test.ts`.
