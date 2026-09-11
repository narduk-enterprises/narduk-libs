# stonx component-usage survey (lane L3)

SHA `d50ad72` on `main`. 502 `.vue` files, 397 components, 71 pages, 4 layouts,
161 composables (`find app -maxdepth 8 -name '*.vue' ... | wc -l`, etc.). Nuxt
`~4.4.6`, Nuxt UI `~4.7.1`, Tailwind `^4.3.0`. **Zero dependency on narduk-core,
narduk-auth, narduk-ui, or narduk-mapkit-nuxt** (`package.json`,
`nuxt.config.ts`) — only narduk-charts (real: 3 usages),
narduk-analytics/narduk-seo (registered as Nuxt modules, no direct `.vue` tag
usage found).

## The 8 most reusable things this app hand-rolls

1. **`app/components/common/CommonEmptyState.vue`** (109 loc, **46 consumers** —
   `grep -rl '<CommonEmptyState\b' app | wc -l`). Near drop-in for narduk-core's
   `AppEmptyState`. Highest-reuse component in the repo.
2. **`app/components/common/CommonPageShell.vue`** (115 loc, **23 consumers**) +
   `app/components/AppHeader.vue` (301 loc) + `app/components/app/AppShell.vue`
   (117 loc) + `app/components/app/AppFooter.vue` (47 loc). Naming mirrors
   narduk-core's
   `LayerAppHeader`/`LayerAppShell`/`LayerAppFooter`/`LayerDashboardShell`
   almost exactly — independently reinvented, zero code sharing.
3. **`app/components/common/MetricCard.vue` + `Metric.vue` + `MetricGrid.vue`**
   (84+97+19 loc, 19+10+17 consumers = 46 combined refs). Exactly the
   KPI/stat-tile shape narduk-ui's `NsReadoutTile` targets; stonx can't use it
   today (no narduk-ui dep).
4. **`app/components/common/ConfirmModal.vue`** (110 loc, 6 consumers). Direct
   duplicate of narduk-core's `AppConfirmModal`; 4+ more one-off confirm modals
   under `app/components/game/` don't even use this one.
5. **`app/utils/formatters.ts`** (690 loc, **134 consumers** —
   `grep -rl "from '~/utils/formatters'" app | wc -l`). 21 exported formatters
   (price, money, percent, compact, date, time, timeAgo). Already centralized —
   a strong target shape for a shared formatting util.
6. **`app/components/market/StockList.vue`** (252 loc, 4 consumers).
   TypeScript-generic `<T>` configurable list/grid/**table** component with
   loading/empty states — the closest in-app precedent to a shared
   `CollectionTable`, scoped to symbol-shaped market data.
7. **`app/components/market/screener/Pagination.vue`** (216 loc, 1 consumer).
   Fully hand-rolled pagination bar (mobile popover page-size picker + desktop
   ellipsis range) — richer than the 12 sites that call Nuxt UI's
   `<UPagination>` directly, which have no page-size control at all.
8. **4 independent filter/search bars**, zero sharing:
   `market/screener/FilterPanel.vue` (366 loc), `game/GameFilters.vue` (145),
   `game/trades/FiltersCard.vue` (56),
   `admin/stats/AdminStatsUsersFilterBar.vue` (39).

Naming-collision flag: two unrelated `LoadingSkeleton.vue` (`achievements/`,
`invite/`) and two unrelated `CardGrid.vue` (`groups/`, `friends/`) share
filenames across feature folders.

## The table story

**18 distinct table surfaces** found (brief named 10; broader
`grep -rln '<UTable\b\|<table\b'` found 8 more: `AdminUsersListPanel.vue`,
`home/floor/MarketPulse.vue`, `pages/admin/scheduled-games/index.vue`,
`AdminSchedulerRunsCard.vue`, `groups/MembersCard.vue`, `market/StockList.vue`,
`pages/admin/auto-games.vue`, plus `AdminStatsUsersTable.vue`'s row partner).
Full field-by-field classification for all 18 is in `stonx.json` →
`patterns.table`.

- **Split roughly evenly** between raw `<table>` (9) and Nuxt UI `<UTable>` (9);
  no `@tanstack/vue-table` direct dependency.
- **Three mobile strategies in active use**, sometimes in the same screener
  flow: horizontal-scroll (`overflow-x-auto`+`min-w-[...]`, 8+ surfaces —
  `admin/games/Table.vue`, `PositionTable.vue`, `BigMoversTable.vue`...),
  hidden-columns (`AdminUsersListPanel.vue`, `MembersCard.vue`), and
  user-selectable cards vs. mobile-table
  (`market/screener/ResultsTableMobileCards.vue` vs
  `ResultsTableMobileTable.vue`, switched by `useScreenerView` composable).
- **Sort UI reimplemented 3 separate times**: `common/SortableTableHeader.vue`
  (43 loc, only 1 consumer — `AdminStatsUsersTable.vue`), an inline hand-rolled
  sort button in `ResultsTableDesktop.vue`, and another independent one in
  `PositionTable.vue` (the only one with `aria-sort`).
- **Server pagination has 3 distinct response shapes**:
  `{data,pagination:{total,page,limit, totalPages,hasNextPage,hasPreviousPage}}`
  (shared `getPaginationParams`/`buildPaginatedResponse` helper in
  `server/utils/query.ts:192`, used by `admin/games`, `me/positions`,
  `leaderboard`); a zod-validated custom shape in `admin/stats-detailed.get.ts`;
  and `{results,count,totalPages, page,status}` in `market/screeners.get.ts` —
  whose `limit` caps at **500**, vs. 100 everywhere else that enforces a cap.
  `watchlist/index.get.ts` and `market/big-movers.get.ts` have no page/limit
  params at all (full-list / bounded-feed).
- **What a shared table must cover here**: server- and client-side sort/paginate
  (both exist), sticky header + row-density modes + whole-row
  keyboard-accessible click-through (`ResultsTableDesktop.vue` is the richest
  example), a page-size picker (only the screener has one), user-configurable
  column visibility (`PositionTable.vue`'s `USelectMenu` picker, unique to it),
  inline cell editing (`WatchlistTable.vue`'s notes field, unique to it), and at
  least the 3 mobile strategies above.
- The repo's own `stonx/file-size-budget` eslint rule (target 180 / hard cap 300
  loc for components — `eslint-plugins/rules/file-size-budget.mjs`) already
  pressures table code out of single files: `PositionTable.vue` (434 loc) and
  `WatchlistTable.vue` (364 loc) both carry an `eslint-disable` to exist; the
  screener's table was split into 9 small files partly to stay under budget.

## What has broken (evidence: `gh issue/pr list --repo narduk-enterprises/stonx`)

- **stonx#208** (closed) "v2 screeners accept unbounded limit and unchecked sort
  columns" → fixed by **stonx#251** "fix: clamp pagination limits".
- **stonx#218** (closed) "Groups list is unpaginated and loads members/tags for
  every group" → fixed by **stonx#266** "fix: paginate public group discovery".
- **stonx#219** (closed) "Group member search filters only the current page" →
  fixed by **stonx#256** "fix: search group members before pagination"
  (`groups/MembersCard.vue`'s server route). Exactly the bug class a shared
  searchable+paginated table prevents by construction.
- **stonx#5** (merged) "Fix leaderboard performance with database-level
  pagination" — `leaderboard/Table.vue` used to be client-paginated.
- **stonx#39** / **stonx#313** (closed) "UTable custom headers should use slots
  instead of `h()` function" / "Replace remaining render-function UTable headers
  with slots" — direct precedent for `SortableTableHeader.vue`'s current
  slot-based pattern.
- **stonx#78** (merged) "Mobile Responsiveness Overhaul - No Horizontal
  Scrolling" — yet 8+ of the 18 surveyed table surfaces still use
  horizontal-scroll today; the fix didn't stick or didn't cover tables.

Component-level test coverage exists for several tables
(`tests/unit/components/{research, portfolio,market,leaderboard,market/screener}/*.test.ts`,
`tests/integration/{screener-filters, watchlist}-hardening.test.ts`) — a
migration should port these, not just the markup.
