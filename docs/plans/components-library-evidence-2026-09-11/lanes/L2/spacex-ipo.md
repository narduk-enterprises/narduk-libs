# spacex-ipo — component survey (L2)

SHA `65c9ca696967c930681835dc2cfe86b54e813e0b`, branch `main`. Nuxt 4.4.8,
`@nuxt/ui` 4.6.0 direct dep (unlike borderwaitstat-us, which only gets it
transitively). Depends on narduk-core/seo/analytics/ui but **uses zero
narduk-libs UI component tags** (`libs_components_used` all zero) -- narduk-ui
appears to be consumed only for `tokens.css`. 18 vue files, 14 components, 3
pages, 0 layouts, 2 composables. All 14 components have exactly 1 consumer
(single-page marketing/tracker site).

## Most reusable hand-rolled things

1. **`apps/web/app/components/spacex-ipo/IpoStatusMatrix.vue`** (67 loc, 1
   consumer) — a 4-tile, tone-coded KPI group
   (Confirmed/Reported/Watching/Unknown counts with icon + note), built from a
   local computed array. Two of the four counts are hardcoded (lines 23, 29)
   rather than derived, but the shape is exactly the `kpi_stat_tile` pattern
   narduk-libs has zero coverage for.
2. **`apps/web/app/components/spacex-ipo/IpoNewsFeed.vue`** (66 loc, 1 consumer)
   — news feed `<ol>` (publisher/date/title/description) sourced from
   `server/api/spacex-news.get.ts`. Contains a **hand-rolled `formatDate()`**
   (line 26): a manual `MONTH_LABELS` array plus
   `getUTCMonth`/`getUTCDate`/`getUTCHours` string-building instead of
   `Intl.DateTimeFormat`.
3. **`apps/web/app/components/spacex-ipo/IpoTimeline.vue`** (51 loc, 1 consumer)
   — status-coded launch timeline `<ol>` (`data-status` attribute +
   `statusLabels` map) plus a decorative CSS radar graphic. Overlaps
   `IpoNewsFeed`'s feed shape; a shared `TimelineFeed` component would need
   per-item status theming and a date formatter.
4. **`apps/web/app/components/spacex-ipo/IpoSources.vue`** (43 loc, 1 consumer)
   — source-citation `<ol>` plus an inline "donut" KPI tile (active-source
   count + 4-color legend) at lines 10-19; a second, independent
   reimplementation of a small stat tile.
5. **`apps/web/app/components/spacex-ipo/IpoWatchList.vue`** (28 loc, 1
   consumer) — plain label/text `detail_list`, no card chrome.
6. **`apps/web/app/components/spacex-ipo/IpoXFeed.vue`** (56 loc) and
   **`IpoXTimelineEmbed.vue`** (95 loc) — two separate X/Twitter embed wrappers;
   worth a follow-up question to Logan about whether both are still needed (both
   1 consumer, both under `pages/index.vue`).
7. Content-only blocks with no reusable UI shape: `IpoS1PlainEnglishCopy.vue`
   (139 loc, largest file), `IpoS1FilingPage.vue` (80), `IpoHero.vue` (108),
   `IpoS1Monitor.vue` (46), `IpoMarketContext.vue` (44), `IpoFaq.vue` (23),
   `IpoDisclaimer.vue` (18).

## Table story

None. No `<UTable`/`<table`/`role="table"` and no `grid-cols-` table-like grid
anywhere in `apps/web/app`. `server/api/spacex-news.get.ts` returns the full
news array unpaginated (only sets a `cache-control` header); there is no
`page`/`limit`/`sort`/`cursor` query parsing anywhere under `server/api`.
Nothing here a shared table component would touch.

## What has broken

`gh issue list --search "table OR pagination OR sort OR overflow OR mobile OR hydration OR empty"`
→ no results. `gh pr list --search "table OR pagination OR sort OR mobile"` → PR
#14 (deploy active-deployment-selection fix, merged) and PR #25 (wrangler
dependency bump, open) — neither concerns UI behavior. An
`e2e/hydration.spec.ts` test exists (listed under `tests_covering_patterns`) but
its content was not read; it tests hydration generally, not a specific broken
pattern.

## Notes

Marketing/editorial site, not a data app -- most components are prose blocks.
The two strongest extraction signals are the repeated small-KPI-tile
reimplementation (`IpoStatusMatrix` + `IpoSources`' donut) and the hand-rolled
date formatter, both listed in `top_extraction_candidates`. Notable for the
estate-wide plan: this app pulls `@nuxt/ui` directly rather than transitively,
and pays for `narduk-ui` (design tokens) without using any of its instrument
components -- a data point on actual narduk-ui component adoption versus mere
dependency declaration.
