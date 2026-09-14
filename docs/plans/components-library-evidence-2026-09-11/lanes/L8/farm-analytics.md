# farm-analytics — component-usage survey (lane L8)

SHA `5ee23343` (main). Nuxt app lives entirely under `farm-boundary-map/` (repo
root also holds an unrelated Python farm-report pipeline). 23 .vue files: 20
components, 1 page (`index.vue` — this is a single-page dashboard), app.vue,
error.vue. **Zero narduk-libs dependencies.** Uses `@nuxt/ui 4.10.0` directly;
vendors `@narduk-geo/narduk-mapkit(-nuxt)` as local tarballs — a different
package family from narduk-libs' `narduk-mapkit-nuxt`.

## Most reusable hand-rolled things (path, LOC, consumers, what a shared version must cover)

1. `farm-boundary-map/app/components/portfolio/PortfolioKpiBand.vue` — 33 LOC, 1
   consumer. Textbook 4-column KPI band (label / big number / unit), 2-col on
   mobile. The single cleanest kpi_stat_tile match across the whole lane. A
   shared version needs: N items, label/value/unit slots, responsive column
   collapse.
2. `farm-boundary-map/app/components/atlas/FarmStatusFilters.vue` — 39 LOC, 1
   consumer. `v-model` segmented status-chip filter bar with per-chip counts,
   `aria-pressed`, `role="group"`, and a mobile horizontal-scroll fallback
   (`scrollbar-width:none` + edge mask fade). Complete filter_search_bar
   reference implementation.
3. `farm-boundary-map/app/components/portfolio/PortfolioFarmGrid.vue` — 42 LOC,
   1 consumer. Card-list-as-table: one tile per farm entity with a 4-state
   status badge (confirmed/provisional/unresolved/placeholder, lines with
   `.status.confirmed` etc.), acres, field/dataset/observation counts, a
   crop-chip list, and click-through — functions as this app's "table." A shared
   table's mobile card mode needs exactly this shape.
4. `farm-boundary-map/app/components/portfolio/PortfolioAttentionList.vue` — 32
   LOC, 1 consumer. Scrollable detail-list with severity icon styling, a
   truncation notice ("Showing X of Y bounded attention items"), and a
   hand-rolled empty state ("No factual attention items were identified...").
   Covers detail_list + empty_state + a pagination-adjacent truncation pattern
   in one file.
5. `farm-boundary-map/app/components/atlas/OpsAppBar.vue` (111 LOC) and
   `FarmOperationsNav.vue` (188 LOC) — custom header/nav; app has zero
   narduk-core so neither uses LayerAppHeader.
6. `farm-boundary-map/app/components/FarmMapStage.vue` — 275 LOC, wraps the
   vendored (non-narduk-libs) mapkit package.

## Table story

No literal `<table>`. The one "table" is `PortfolioFarmGrid.vue` — a
card-list-as-table, 6 effective columns (name, status badge, acres, counts, crop
chips, link), row-click-through, responsive 3→2→1 column collapse, no
sort/pagination (server returns everything). Server side,
`farm-boundary-map/server/api/farms.get.ts` has a genuine search contract — `q`
(trimmed, lowercased, capped to 160 chars) plus `includeUnresolved`/
`includePlaceholders`/`includeFootprints` boolean flags — but **no
page/limit/cursor params**; it returns the full filtered set
(`FarmListResponse`). A shared table here would need: card mode as primary (this
app is single-page dashboard shaped, not row-dense), status-badge column type,
chip-list column type, and a client-or-server search box wired to the existing
`q` contract.

## What has broken (evidence: `gh issue/pr list --repo narduk-enterprises/farm-analytics`)

- No table/pagination/sort/mobile issues found (search limit 40, both issues and
  PRs). PR #1 "redesign Farm Atlas as Ops Atlas" (merged) is the only UI-shaped
  history; PR #17 is a routine `@nuxt/ui` version bump.
- No pattern-related tests found
  (`grep -rliE 'table|pagination|sort' test --include='*.ts'` matched only files
  whose content is unrelated word-boundary hits, e.g. `farm-browser.test.ts`
  testing the `q` search).

## Surprise

Despite zero narduk-libs adoption, this is the most "pre-shaped" app in the
lane: components are already named and scoped almost exactly like the target
schema (KpiBand, StatusFilters, AttentionList) — it reads like it was built by
someone who already had the shared-component vocabulary in mind.
