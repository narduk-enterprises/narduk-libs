# Components library plan — a usage-driven component family for narduk-libs

Status: **proposal, decisions open (§7)**. Written 2026-09-11 from a read-only
survey of 34 repositories (29 Nuxt apps) plus narduk-libs internals, then
revised against an adversarial review
([`critique/critique.md`](./components-library-evidence-2026-09-11/critique/critique.md):
3 blockers, 10 majors, 8 minors — every finding is folded in below and marked
`[B1]`…`[M10]` where it changed the text). Evidence: one JSON and one Markdown
report per repository under
[`components-library-evidence-2026-09-11/lanes/`](./components-library-evidence-2026-09-11/),
lane L0 being narduk-libs itself. Every count was produced by a recorded command
in the lane's JSON (`counts.commands`); every claim carries a path. Survey
claims are hypotheses at execution time — a lane re-verifies live before
mutating anything this plan names.

Nests under company-hq **D-WEBFOUND-2** (2026-09-04): four package families in
narduk-libs, `narduk-ui` + `narduk-shell` as the coded NE design system synced
to NE Base, `foundation:check` as the gate, fleet = estate + clients, incubator
on promotion. **One question in §7 (Q1, the family's home) is a D-WEBFOUND-2
amendment whichever way it is answered** — each option names the ratified line
it edits, and the answer is routed to a dated `DECISIONS.md` amendment `[B2]`.
The other three questions reopen nothing.

## 1. The one-paragraph answer

**No.** narduk-libs has no sortable, paginated table — or any table. `narduk-ui`
(0.1.2) ships tokens and four status instruments; `narduk-core` ships fourteen
thin app components the fleet has barely adopted (`AppEmptyState`: 0 uses in 29
apps, 12 local re-implementations). The fleet hand-rolls **71 table surfaces in
15 apps** (≈15.9k LOC of table-bearing files; ≈3.7k LOC the lanes judged
deletable by a shared table, counted on distinct paths and capped at file size
`[M1][M2]`), with **none** offering sort + pagination + search together, **12+
server list shapes**, five mobile strategies, and 41 keyword-matched defect
records of which 29 concern list/table UI behaviour on reading `[M6]` — search
applied after pagination, unbounded or unclamped lists, sideways scroll on
phones, inert sort flags, timezone-dependent formatting. The recommendation is
**not a new library** but an **app-tier component family inside the coded NE
design system**, built on Nuxt UI, registered by a Nuxt module, **reaching apps
through a grouped dependency-bump wave and a `foundation:check` pin item**
(exact pins are ratified, so nothing arrives "for free" `[B1]`), gated by the
documentation/test/story presence check narduk-libs currently lacks, and rolled
out on the migration waves company-hq already sequenced. Wave 1a is the
_collections_ core — data table, pager, one `useCollection` state composable,
one server list-query contract; wave 1b is the _feedback_ set (state panel,
status badge), the framework-free _format_ output, and the discovery machinery
that makes any of it stick.

## 2. What exists today (narduk-libs, HEAD `54577ac`)

Source:
[`lanes/L0/narduk-libs.md`](./components-library-evidence-2026-09-11/lanes/L0/narduk-libs.md).

| Fact                                                                                                                                                                                                                                                                                                                                                    | Evidence                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 55 shared `.vue` components/layouts across core/auth/analytics/seo/ai/ui/charts/mapkit-nuxt; **5 fully README-documented, 5 mount-tested, 45 with no component-level test**                                                                                                                                                                             | L0 §1                                                           |
| Three registration mechanisms: `addComponentsDir` with `pathPrefix:false` (core/auth/analytics/seo/ai — a same-named app component shadows silently), `addComponent` (mapkit-nuxt), and **no module at all** (narduk-ui, narduk-charts: manual import only)                                                                                             | L0 §2, `narduk-core/src/module.ts:544-547`                      |
| **`create-narduk-app` never wires narduk-ui or narduk-charts** — neither is pinned in `manifest.ts`; a fresh scaffold is `<UApp><NuxtLayout><NuxtPage/></UApp>`                                                                                                                                                                                         | L0 §10                                                          |
| `narduk-ui` is deliberately framework-free: no `dependencies`, `peerDependencies` = `vue` only, `"build": "pnpm run typecheck"`, `files` is an allowlist (`tokens.css`, `instruments`, `_core`, `README.md`); five status apps pin `0.1.2` exactly `[M8]`                                                                                               | `packages/design/narduk-ui/package.json`, README guardrails 1–3 |
| Two non-interoperable styling systems: `--ns-*` tokens (instruments + charts only) vs the Nuxt UI theme in narduk-core `app.config.ts` (everything else). This already caused operator-portal#238 (login card contrast)                                                                                                                                 | L0 §3, `narduk-auth/tests/auth-login-card-contrast.test.ts`     |
| The eslint `design-system` pack bans raw `<table>` ("Use `<UTable>`") **for apps that select the pack**; narduk-libs' own `eslint.config.mjs` composes `core/correctness/complexity/formatting` only, and the generator hardcodes the same four packs (`generate.ts:528`) — so neither the library nor a scaffolded app is under that rule today `[M3]` | `eslint-config/configs/design-system.mjs:88`, L0 §3, §10        |
| No list/pagination/sort contract in `narduk-platform`; narduk-libs' own three list endpoints use three shapes (`{users,page,limit,total}`, `{notifications}`, bare array)                                                                                                                                                                               | L0 §5–6                                                         |
| `require-limit-on-drizzle-list-queries` forces a real `.limit()` on every Drizzle list query — a shared list helper must still make callers supply a bound                                                                                                                                                                                              | L0 §6                                                           |
| `@nuxt/ui` is pinned exactly at `4.6.0` in narduk-core while the fleet spans `^4.3.0` → `4.11.0`; `UTable`'s header API already cost stonx#39 and stonx#313 `[M5]`                                                                                                                                                                                      | `narduk-core/package.json`, merge §1, `lanes/L3/stonx.json`     |
| NE Base previews are one hand-authored `app.vue` with 6 cards (4 instruments, foundations, one Nuxt UI card); nothing scans for components                                                                                                                                                                                                              | L0 §8                                                           |
| Adding a package costs workspace wiring + changeset + full quality gate + an out-of-workspace consumer-fixture install + a generator manifest pin; adding a subpath export to an existing package costs the changeset, a `files` allowlist entry, and a fixture assertion that the new subpath actually publishes `[M8]`                                | L0 §9, `AGENTS.md` § Validation                                 |

## 3. What the fleet actually builds by hand (34 repos, 2026-09-11)

Scope: every web app in `narduk-enterprises` and `narduk-enterprises-clients`
(D-WEBFOUND-2 Q10); `narduk-incubator` and the `loganrenz` personal plane are
out. Four rows are not Nuxt apps (caminoreal = Astro, pnl and viking-pandl =
static, software-delivery = Worker) and one (`narduk-family-location`) no longer
exists in either org, so **29 Nuxt apps** carry patterns (the merge script's
"30" includes that failed clone with zero patterns). Shallow clones at the SHAs
recorded in each JSON.

**What the numbers license.** A pattern instance is a file a lane classified;
LOC is that file's `wc -l` (page files carry non-table code, so table LOC is an
upper bound); "consumers" is `grep -rl '<Name\b'` file counts; defect history is
a 40-issue + 40-PR keyword search per repo, titles only, then hand-read. **462
files were classified and 54 of them sit under two to seven patterns** (e.g.
bluebonnet `AdminObservations.vue` under 7), so per-pattern rows are distinct
within a pattern but never sum across patterns `[M1]`. pacc-trac was surveyed on
`main`, which is still the single-app layout — the S1 workspace split lives on
the unmerged `integration/correctify` branch.

### 3a. Pattern ranking (29 Nuxt apps; distinct files within each row)

| Pattern                                   | Apps   | Files                                        | File LOC   | Consumers              | What narduk-libs ships                                         |
| ----------------------------------------- | ------ | -------------------------------------------- | ---------- | ---------------------- | -------------------------------------------------------------- |
| card_list (collection renderer)           | 22     | 49                                           | 4,735      | 48                     | nothing                                                        |
| status_chip_badge                         | 19     | 26                                           | 982        | 161                    | `NsFreshnessChip` only (freshness, not status)                 |
| layout_shell_nav                          | 18     | 36                                           | 3,089      | 49                     | `Layer*Shell` (unused); `narduk-shell` proposed (#119)         |
| filter_search_bar                         | 18     | 31                                           | 2,387      | 43                     | nothing                                                        |
| kpi_stat_tile                             | 17     | 27                                           | 2,127      | 73                     | `NsReadoutTile` (1 app uses it)                                |
| empty_state                               | 16     | 25                                           | 696        | 133                    | `AppEmptyState` (0 uses, 12 copies)                            |
| **table**                                 | **15** | **71**                                       | **15,852** | **108**                | **nothing**                                                    |
| date_time_format + number_currency_format | 14     | **21 distinct** (18 + 8 with 5 shared files) | 2,950      | **228** (max per file) | nothing                                                        |
| form_field_patterns                       | 13     | 21                                           | 2,351      | 10                     | Nuxt UI `UForm` suffices                                       |
| map_wrapper                               | 12     | 19                                           | 4,202      | 25                     | `AppMapKit` (7 apps use it — the adoption success story)       |
| chart_wrapper                             | 11     | 16                                           | 1,937      | 17                     | narduk-charts (5 apps use it; 3 apps hand-roll charts instead) |
| pagination_control                        | 9      | 11                                           | 1,270      | 31                     | nothing                                                        |
| page_header / section_header              | 7 / 7  | 8 / 9                                        | 628 / 399  | 58 / 16                | nothing                                                        |
| confirm_modal                             | 7      | 12                                           | 143        | 46                     | `AppConfirmModal` (1 app uses it)                              |
| sort_control                              | 6      | 8                                            | 390        | 7                      | nothing                                                        |

Regenerable from the lane JSON with the orchestrator's `merge_reports.py`; the
distinct-path recompute is recorded in the critique's fold notes.

### 3b. The table story, in detail

71 surfaces: 27 in pacc-trac, 18 in stonx, 5 in harmony-hot-sauce, 3 each in
harvest-tracker, nvault, papa-everetts-pizza, 2 each in
bluebonnet-status-online, circuit-breaker-online, gonogo, 1 each in buoys,
farm-analytics, hydrogen, lakestat-us, ogpreview-app, operator-portal.

- **Sorting.** pacc-trac: none of 27 support interactive column sort
  ([L4 pacc-trac.md](./components-library-evidence-2026-09-11/lanes/L4/pacc-trac.md)).
  stonx: three independent implementations (`common/SortableTableHeader.vue`,
  inline in `ResultsTableDesktop.vue`, `PositionTable.vue` — the only one with
  `aria-sort`). harmony: 5 `UTable` uses, none wire `v-model:sorting`.
  bluebonnet: `sortable:true` column flags with no sorting model — **inert**.
  operator-portal: none; two open issues ask for it (#330, #201).
- **Pagination.** Server offset in pacc-trac (`usePagedList`, 14 consumers,
  tested), stonx (3 shapes), circuit-breaker, bluebonnet, float-forecast,
  riverstatus; cursor in nvault and mybo-at-v2; client in stonx leaderboard
  until stonx#5 moved it to the database; **none** in harmony, harvest-tracker,
  operator-portal (read-model snapshots, no list routes at all `[B3]`), lakestat
  (full filtered set returned).
- **Search.** stonx#219/#256: "search filters only the current page" — merged
  fix; the class recurs wherever search is client-side over a server page.
- **Query parsing is where the defects are** `[Q3]`: stonx#188 (negative limit),
  #208 (unbounded limit, unchecked sort columns → #251 clamp), #218/#266
  (unpaginated discovery), mybo-at-v2#14 (unbounded response bytes →
  `ORG_LIST_LIMIT` + cursor), plus six routes with no bound at all (narduk-nvr
  members, papa-everetts users/menu, lakestat directory, farm-analytics farms,
  x-event-recap recaps, stonx watchlist). No recorded defect is caused by a
  response envelope.
- **Mobile.** Five strategies: horizontal scroll (pacc-trac's global CSS safety
  net `main.css:395-421`; stonx 8+ surfaces despite stonx#78 "No Horizontal
  Scrolling"), hidden columns (stonx), card-list toggles at inconsistent
  breakpoints (nvault `md:` vs `lg:`), semantic reflow with roles preserved, and
  nothing at all (harmony: `overflow-hidden` wrappers, unreachable columns on
  phones as an inferred risk). **Reflow verified live** `[M4]`: operator-portal
  `CollectionTable.vue:10-25` at `fe1192d` keeps the same DOM below 1000 px and
  prohibits horizontal scroll, hidden columns, sticky first column and
  identifier truncation — the lane's JSON `mobile: "cards"` field was wrong, its
  prose was right.
- **Column types seen everywhere:** text, number, money, date/datetime/relative,
  badge, link, actions, image. papa-everetts had to `eslint-disable` its own
  local "use UTable" rule because `UTable` could not right-align `tabular-nums`
  numeric columns
  ([L5 papa-everetts-pizza.md](./components-library-evidence-2026-09-11/lanes/L5/papa-everetts-pizza.md)).
- **Server contracts (merge §7):** at least 12 response shapes across ~35 list
  routes. Offset-style dominates — pacc-trac's `{ rows, total, limit, offset }`
  behind `paged=1` is shared by 20 routes; riverstatus wraps
  `createPaginatedEnvelope`; harvest-tracker uses
  `{ items, limit, nextOffset, offset }`; stonx has three. Cursor-style: nvault
  (`cursor, limit`
  - 12-key filter allowlist that rejects unknown keys, typed
    `AuditPageResponseSchema`) and mybo-at-v2 (`after`, `ORG_LIST_LIMIT=200`).
- **Prior art to build from, strongest first:** pacc-trac `Ledger/Table.vue` +
  `usePagedList` + `DenseListPager.vue` (hardened, tested, clamp-on-mutation
  solved); operator-portal `CollectionTable.vue` (421 LOC, 17 consumers, 647 LOC
  of e2e/unit tests, reflow a11y); nvault `audit/index.vue` (cursor + filter
  allowlist; no URL state); hydrogen `SimpleTable.vue` (54 LOC — proof a
  `UTable` wrapper can be small); tx-spends `DataTableCard.vue` (personal plane,
  reference only: `manualSorting` + `UPagination` + stale-while-loading, no
  column types). The corpus claim of an `AppDataTable.vue` in control-plane is
  false — that repo has 11 bare `<UTable>` uses and no wrapper (L0 §11).

### 3c. Everything else worth extracting

- **State panel / empty state.** operator-portal `StatePanel.vue` (89 LOC, **22
  consumers**, variants empty/blocked/clear/absent), stonx
  `CommonEmptyState.vue` (109 LOC, **46 consumers**), hydrogen `DataState.vue`
  (25 LOC, 10 consumers, unifies loading/error/empty), riverstatus
  `RiverUnavailablePanel.vue` (19 LOC, 14 consumers) — all the same slot as
  narduk-core's unused `AppEmptyState`, and richer than it.
- **Status badge.** pacc-trac's nine chip components (419 LOC, 62 consumers; PR
  #774 "One chip, fed by one label table" merged, yet nine chip files remain at
  HEAD), harvest-tracker `AvailabilityChip`/`CropChip` (228 LOC, 14 consumers),
  operator-portal four small chips, harmony `AdminStatusBadge`, mybo-at-v2
  `EdgeStatusBadge`.
- **Formatters — 21 distinct files, 228 consumers** `[M1]`: stonx
  `utils/formatters.ts` (690 LOC, 21 exports, 134 consumers), harvest-tracker
  `almanac-format.ts` (321 LOC, 48 consumers), pacc-trac
  `shared/utils/format.ts` (69 LOC, 36 consumers), riverstatus and lakestat
  format utils, been-sober-for `sobrietyTime.ts` (issue #7: SSR hydration
  mismatch from local-time getters on the Worker vs the client — the defect
  class a shared, timezone-explicit formatter removes), nvault's hand-copied
  `Intl.DateTimeFormat` helper.
- **KPI tile.** stonx `Metric*` family (46 refs), farm-analytics
  `PortfolioKpiBand`, austin-texas-net animated `StatCard` + `SeverityRing`,
  operator-portal `SparkTile` (KPI with sparkline), float-forecast four
  tile-grid components, mybo-at-v2 `VesselStateCards`.
- **Filter bar.** 31 files; stonx alone has four (366/145/56/39 LOC), buoys
  three, farm-analytics `FarmStatusFilters` (accessible segmented filter with
  counts).
- **Collection list.** buoys `StationList.vue` family (335 LOC, `variant` =
  cards/compact/rows) is the cleanest density-mode renderer and the natural
  sibling of the table (same column/row model, different renderer).
- **Page header.** tprinvest `PageHeader` (21 LOC copied 7×), circuit-breaker
  `MarketingPageTemplate` (268 LOC, 12 consumers).
- **Already shipped, locally shadowed — reconcile, don't extract:**
  been-sober-for `auth/{Login,Register,Exchange}*.vue` (606 LOC, 0 consumers)
  and bluebonnet `auth/*` (637 LOC, 0 consumers) collide name-for-name with
  narduk-auth's `AuthLoginCard`/`AuthRegisterCard`/ `AuthExchangePanel`;
  austin-texas-net `app/MapKit.vue` (915 LOC, **11 consumers — an active shadow,
  not dead code**) collides with `AppMapKit`. With `pathPrefix:false` a copy
  either shadows the library or is dead; a build-level check decides which
  before anything is deleted.
- **Charts.** austin-texas-net has two near-identical `vue-chartjs` wrappers
  (454 LOC), hydrogen 277 LOC of inline SVG, lakestat a hand-rolled history
  chart — all `NardukLineChart` cases (operator-portal#224, closed, is the
  adoption pattern to copy).

### 3d. Adoption today (tag occurrences, merge §8)

`AppMapKit` 7 apps · `NardukLineChart` 5 · `NsFreshnessChip` 3 · `AuthLoginCard`
2 (harvest-tracker, operator-portal) · `AuthRegisterCard`, `AppConfirmModal`,
`AppTabs`, `AppLightbox`, `LayerNetworkFooter`, `NsReadoutTile`,
`NardukPieChart`, `NardukCandleChart` 1 each ·
`AppEmptyState`/`AppBreadcrumbs`/`AppCopyButton`/`AppShareButtons` **0**. Nine
apps still `extends` the retired `narduk-nuxt-template-layer-*`
(austin-texas-net, bluebonnet, circuit-breaker, harmony, llb-cpa, papa-everetts,
tprinvest, float-forecast, ogpreview-app); four have no narduk-libs dependency
at all (pacc-trac, nvault, farm-analytics, earthdata-viewer via vendored `file:`
deps); stonx has charts/analytics/seo but not core. Four client repos carry the
same open tracker for the template-layer exit (circuit-breaker#38, llb-cpa#48,
papa-everetts#75, tprinvest#50 — all citing harmony#87 as the pattern).

**Lesson the numbers force:** shipping a component is not adoption. narduk-core
has auto-registered `AppEmptyState` in every mandatory install for months and it
has zero consumers while twelve copies exist. The family below therefore ships
_with_ its adoption and enforcement surface (pin wave, docs, NE Base cards,
lint, `foundation:check`, generator wiring), not before it.

## 4. Target state

Normative statements in §4a–4c are design intent; the gates that make them
binding are the declared items in §4d, each `enforcement: none yet` until it
ships `[M10]`.

### 4a. One app-tier component family, in the coded NE design system

A set of outputs, provisionally prefixed **`Ne`** (distinct from instruments'
`Ns*`, narduk-core's `App*`, and every app's own `App*` — a collision guard, see
§3c; provisional because D-WEBFOUND-2 Q7 parks renames until the folds land),
composed from Nuxt UI, themed through the Nuxt UI `app.config` contract,
registered by a Nuxt module:

| Output                                           | Components / exports                                                                                                                                     | Replaces (evidence)                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `collections`                                    | `NeDataTable<T>`, `NeCollectionList<T>`, `NePager`, `NeFilterBar`, `useCollection<T>()`, `defineColumns<T>()`                                            | 71 tables, 49 card lists, 11 pagers, 31 filter bars |
| `feedback`                                       | `NeStatePanel` (empty · loading · error · blocked · absent), `NeStatusBadge` (tone × label, ARIA), `NeConfirmModal` (moved from core)                    | 25 empty states, 26 chips, 12 confirm modals        |
| `format` (framework-free, like `narduk-ui/core`) | `formatDate/DateTime/Relative/Duration`, `formatNumber/Compact/Percent/Money/Quantity`, all `Intl`-based with an explicit timezone and SSR-stable output | 21 formatter files, 228 consumers                   |
| `page` (wave 4, with the shell's rail)           | `NePageHeader`, `NeSectionHeader`, `NeKpiTile`, `NeKpiBand`                                                                                              | 17 headers, 27 KPI tiles                            |

Where it lives is **Q1** (§7). Whichever home wins, the outputs are subpath
exports of one package with one version.

**How it reaches an app** `[B1]`. Exact `@narduk-enterprises/*` pins are a
ratified `foundation:check` failure (web-foundation plan §4 item 2, Q9), so
module auto-registration only helps _after_ an app pins the version. The
mechanism is: (1) Renovate/Dependabot grouping of `@narduk-enterprises/**` (§4
item 5) so the family arrives in one bump PR per app; (2) a bump wave in §6 that
opens those PRs deliberately rather than waiting; (3) a `foundation:check` item
"family pinned at ≥ the wave's version" so an unbumped app is visible in the
weekly rollup.

### 4b. `NeDataTable` — the contract

Built on Nuxt UI `UTable` (TanStack under the hood — **Q2**), the wrapper owning
everything the fleet gets wrong:

- **Columns are typed.**
  `defineColumns<T>([{ key, label, type, sortable, align, width, hideBelow, format }])`
  with
  `type ∈ text | number | money | date | datetime | relative | badge | link | actions | image | custom`.
  Numeric types render right-aligned `tabular-nums` mono by default (the
  papa-everetts gap); `date*` types go through `format` with an explicit
  timezone (been-sober-for#7 class); `badge` renders `NeStatusBadge`; `link`
  renders a keyboard-reachable row link (pacc-trac `LinkedId`, stonx screener
  whole-row click).
- **State is one object.** `v-model:state` =
  `{ sort: {key, dir}, page, pageSize, q, filters }`, or the individual
  `v-model:sort` / `v-model:page` / `v-model:q` when a page only needs one.
  `mode: 'client' | 'server'`. In server mode the table never slices, sorts, or
  searches an array itself — search and filters go to the server _before_
  pagination (stonx#219 by construction) and `total` comes back from it.
- **`syncQuery`** writes the state to the route query
  (`?sort=name:asc&page=2&q=…`) so filtered views are shareable and
  back-button-safe (nvault, lakestat, stonx admin all wanted this; nvault
  hand-rolled a cursor history stack instead).
- **Mobile is a prop, default `reflow`** (verified live in §3b).
  `mobile: 'reflow' | 'cards' | 'scroll' | 'hide'`. `reflow` keeps the DOM and
  roles (operator-portal's behaviour, its two e2e specs ported as the family's
  own); `scroll` is the pacc-trac house style for wide ledgers; `cards` uses
  `NeCollectionList` with the same columns; one breakpoint prop, never two DOM
  trees.
- **Every state renders.** `loading` (skeleton rows; stale-while-loading keeps
  the last page dimmed), `error`, `empty` (all `NeStatePanel`), a required
  `caption` (sr-only by default), `sticky-header`, `density`, optional
  `selectable`, optional `more` bounded-read footer (operator-portal's shape)
  for read-model pages that must not paginate.
- **`useCollection<T>(fetcher, options)`** owns client-side fetching:
  single-flight, coalesced triggers, stale-scope cancellation, debounced search
  (250 ms, pacc-trac), clamp page on mutation (pacc-trac's solved edge case),
  inactive-tab pause, and mutation-triggered refreshes merged with any scheduled
  refresh `[M7]`. The statement/response ceilings belong to the server half
  (§4c); correctness parity, the stress case, rollback thresholds, and truth
  across authorization/tenant boundaries and missing/stale/unknown/proven-zero
  states are proven **in each pilot repository** (§6, wave 2), because the
  data-path contract demands proof in the target repo `[B3][M7]`.
- **Supported Nuxt UI range** `[M5]`: minimum `4.6.0` (narduk-core's pin); the
  wave-1 gate tests the wrapper against the lowest and highest versions the
  fleet runs (`4.6.0` … `4.11.0`) and the family's peer range is declared from
  that test, not assumed.

### 4c. One server list contract (**Q3**)

The defect record (§3b) sits entirely in **query parsing**, so the query half is
what gets gated; the response envelope is a recommended default that
`useCollection({ adapter })` can bypass indefinitely. Published in
`contracts/narduk-platform` as zod schemas, implemented as a helper pair in
narduk-core, and required by the `foundation:check` item in §4d.3:

```ts
// query — the gated half. Every param optional, every param clamped:
//   limit ≤ maxLimit (default 100; a route may raise it, stonx screeners use 500)
//   { offset } | { cursor }; sort ∈ route allowlist, as '<key>:<asc|desc>'; q; allowlisted filters
//   unknown keys rejected (nvault's discipline) — never silently ignored
parseListQuery(event, { sortable: [...keys], filters: zodObject, maxLimit })
// response — the default half (not gated):
{ items: T[], total: number | null, limit, offset, sort, q }      // offset mode
{ items: T[], nextCursor: string | null, total: number | null }  // cursor mode
listResponse(items, { total, query })
```

`limit` is always present (satisfies `require-limit-on-drizzle-list-queries`);
`total: null` is a legal "not counted" (bounded feeds like stonx big-movers).
Existing shapes migrate through the `adapter` option, so an app can adopt the
table before it rewrites its routes. narduk-libs' own three list endpoints
migrate first (C1).

### 4d. What makes it stick (declared gates)

1. **Docs + tests + story or it does not export.**
   `scripts/check-component-surface.mjs`, run in `pnpm run quality`, fails when
   an exported `.vue` lacks a README section (props, emits, slots), a mount
   test, a Workers-safe SSR render (like `narduk-charts/src/ssr.test.ts`), and
   an NE Base card — the new family first, the existing 55 on a schedule.
   <!-- enforcement: none yet -->
2. **Lint.** `narduk/no-shadowed-shared-component` (an app component whose
   registered name equals a narduk-libs export is an error — the
   Auth\*/AppMapKit shadows) and `narduk/prefer-shared-collection` (raw
   `<table>`/`<UTable>` in an app file warns toward `NeDataTable`), the latter
   **active only when the family is a dependency of the app** so an app carrying
   the `design-system` pack without the family still has satisfiable markup
   `[M9]`; the `design-system` pack's `<table>` message updates accordingly. The
   generator adds the `design-system` + `nuxt-ui` packs it already omits (a
   defect, filed separately).
   <!-- enforcement: none yet -->
3. **`foundation:check` items** (W5(a), company-hq#628; rollup #629): "family
   pinned at ≥ the wave's version", "no local copy of a `Ne*`/`App*`/`Ns*`
   export" (extends §4 item 4 of the web-foundation contract), and "every list
   route parses with `parseListQuery`". All three start as warnings for one
   wave, then fail. <!-- enforcement: none yet -->
4. **Generator.** `create-narduk-app` pins the family and scaffolds one
   `NeDataTable`-backed admin list page behind the `auth` capability.
   <!-- enforcement: none yet -->
5. **NE Base.** Each component ships its gallery card in `design-system-build`;
   `/design-sync` pushes the family into NE Base per D-WEBFOUND-2 Q3.
   <!-- enforcement: none yet -->
6. **Styling contract, stated once.** Instruments stay on `--ns-*`; app-tier
   components theme through Nuxt UI semantic classes only (raw palette classes
   are already linted). The shell token preset (#119) sets Nuxt UI's `--ui-*`
   variables from NE tokens so both tiers derive from one accent/structure
   source and the operator-portal#238 class cannot recur; narduk-ui README
   guardrail 3 is amended to say so. <!-- enforcement: none yet -->
7. **Publication proof.** The consumer fixture asserts every new subpath import
   resolves from the packed tarball (a `files` allowlist omission otherwise
   ships an empty output with CI green `[M8]`), and each component carries a
   client bundle budget (`NeDataTable` ≤ 25 kB gzipped excluding Nuxt UI).
   <!-- enforcement: none yet -->

## 5. Workstreams

Sizes are agent-lane days, ± half; owner = a narduk-libs lane per issue,
reviewer = Logan.

| #   | Workstream                                                                                                                                                                                                                                                                                         | Owner package                                                           | Size       | Depends on        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------- | ----------------- |
| C0  | §7 answers recorded (DECISIONS.md amendment for Q1); family skeleton (home, Nuxt module, `files`, peer ranges, prefix, README); `check-component-surface.mjs`                                                                                                                                      | design/                                                                 | 2          | —                 |
| C1  | List-query contract + `parseListQuery`/`listResponse` + contract tests (clamp, allowlist, unknown-key rejection, statement ceiling); migrate narduk-libs' own three list endpoints                                                                                                                 | narduk-platform, narduk-core                                            | 3          | C0                |
| C2  | `format` output (union of stonx/harvest/pacc-trac/riverstatus/lakestat formatters; SSR-stable; timezone explicit)                                                                                                                                                                                  | design/                                                                 | 2          | C0                |
| C3  | `collections` core: `useCollection`, `defineColumns`, `NeDataTable`, `NePager`; ported operator-portal e2e specs and stonx unit tests; axe baseline via narduk-testkit; Nuxt UI range test                                                                                                         | design/                                                                 | 10         | C1, C2            |
| C4  | `feedback`: `NeStatePanel`, `NeStatusBadge`, `NeConfirmModal`; `NeFilterBar`, `NeCollectionList`; core `App*` aliases for one N-1 window (expire at the next narduk-core minor)                                                                                                                    | design/, narduk-core                                                    | 4          | C0                |
| C5  | Adoption machinery: Renovate grouping check, lint rules, generator packs + pin + scaffolded list page, `foundation:check` items, NE Base cards                                                                                                                                                     | eslint-config, create-narduk-app, narduk-app-tools, design-system-build | 5          | C3, C4            |
| C6  | Pilots: operator-portal (D-WEBFOUND-2 Q4 first consumer — **client mode + reflow**), pacc-trac ledger (4 index pages + `usePagedList` — **server offset + scroll**), stonx admin tables (3 — **server sort/paginate/search**); each carries the scale test and rollback thresholds in its own repo | apps                                                                    | 4 each     | C3–C5             |
| C7  | Fleet bump wave + adoption sweep on the W5 groups; reconcile shadowed Auth\*/MapKit copies; chip and formatter consolidation; unbounded routes onto `parseListQuery`                                                                                                                               | apps                                                                    | 0.5–2 each | C6                |
| C8  | `page` output with the shell's rail (#119): headers, KPI tiles                                                                                                                                                                                                                                     | design/                                                                 | 4          | shell design pass |

## 6. Sequencing and gates

- **Wave 0 (this week).** C0 after §7; C1 and C2 in parallel. **Gate:**
  `pnpm run quality` green with the surface check active; the consumer fixture
  installs the new home and resolves every declared subpath; DECISIONS.md
  amendment merged.
- **Wave 1a (2 weeks).** C3. **Gate:** `NeDataTable` in **client mode** passes
  the ported operator-portal reflow specs and the stonx#219 regression test
  (search before pagination, in server mode against a fixture server); SSR
  render passes; axe reports zero serious/critical violations; bundle budget
  met; the wrapper is tested against Nuxt UI `4.6.0` and `4.11.0` `[B3][M5]`.
- **Wave 1b (1–2 weeks).** C4 + C5. **Gate:** every exported component has
  README + mount test + SSR test + NE Base card; lint rules and
  `foundation:check` items report as warnings; the generator scaffolds a list
  page that passes its own e2e.
- **Wave 2 (pilots, 2–3 weeks).** C6 — three apps, three table styles. **Gate
  per pilot:** server mode proven in that repo with the data-path scale test
  (history × live cardinality axes, statement ceiling, response bytes, latency
  budget, stress case), rollback thresholds recorded against the exact commit,
  LOC deleted and defects closed recorded in the PR; those numbers replace the
  estimates below.
- **Wave 3 (fleet).** C7 rides the W5 adoption groups (borderwaitstat-us,
  spacex-ipo, lakestat-us, been-sober-for, harvest-tracker first; the
  template-layer clients as they exit the layer). `foundation:check` items flip
  from warning to failure at the end of this wave.
- **Wave 4.** C8 once the shell's design pass with Logan has happened (#119
  precondition).

**Estimated deletable app code** (lane estimates on distinct paths, capped at
file size; §3 method): table ≈3.7k LOC across 12 apps, shadowed auth copies
1.2k, charts 0.6k, chips 0.5k, KPI tiles 0.5k, pagers 0.3k, shells 0.3k, filter
bars 0.3k, empty states 0.2k, formatters 0.3k, the rest under 0.3k each —
**≈9.0k LOC across 29 apps**, before the per-page cell/slot code that typed
columns remove; a further ≈1.6k LOC (papa-everetts' admin panels) goes away by
adopting the narduk-auth/analytics panels that already exist, independent of
this plan `[M2]`. Reliability: of the 41 keyword-matched records, 29 concern
list/table UI behaviour; they fall into six classes, five of which the query
contract and the table's state model remove by construction (search-after-page,
unbounded/unclamped lists, inert sort, sideways scroll, tap targets under 44
px); timezone formatting is removed by `format`; the remaining records are data,
retention, or deploy defects the keyword caught `[M6]`.

## 7. Decisions needed from Logan

Put through the structured multiple-choice surface (askme), recommended option
first. **Q1 is a D-WEBFOUND-2 amendment in every option** — the answer is
recorded as a dated amendment `[B2]`.

- **Q1 Home for the app-tier family.** (a) **Recommended: `narduk-shell`** — the
  Nuxt-side half of the coded design system under Q3(a), already destined to
  carry the `--ui-*` token bridge and to depend on `@nuxt/kit` + `@nuxt/ui`; the
  package ships the component family first and the rail after its design pass.
  Edits: #119's non-goal "no table/list primitives" and D-WEBFOUND-2 Q3's
  parenthetical scope ("rail, layout, PACC·TRAC tokens") widen to "app-tier
  design system"; narduk-ui stays framework-free and status-scoped. (b) A new
  `@narduk-enterprises/narduk-components` package in `design/` — cleanest
  cadence, +1 package of release cost and a generator pin; edits Q2(a)'s named
  `design/` membership. (c) New outputs in `narduk-ui` plus a `narduk-ui/nuxt`
  module — one package, but adds Nuxt and Nuxt UI dependencies to the estate's
  one framework-free package, breaks the five status apps' `0.1.2` pins at
  `0.2.0`, and edits §4 item 3 ("narduk-ui + status-runtime on status apps")
  `[M8]`. (d) Grow narduk-core's `shared/` directory — zero wiring, but
  design-system components in `modules/` against Q3(a)'s spirit, and UI fixes
  ride the runtime's release.
- **Q2 Table foundation.** (a) **Recommended:** wrap Nuxt UI `UTable` (TanStack)
  — small component, typed columns solve the numeric-alignment gap,
  operator-portal's reflow behaviour and tests ported; cost is `UTable` API
  churn across the fleet's `4.6`–`4.11` spread `[M5]`. (b) Port
  operator-portal's semantic `<table>` and add sort/page/search — full markup
  control at the cost of reimplementing TanStack's row models (no lint exemption
  is needed — the ban applies to apps on the `design-system` pack, not the
  library `[M3]`). (c) Both renderers behind one column model from day one —
  roughly 1.5× wave-1a. (d) Headless first — ship `useCollection` +
  `defineColumns` + `NePager` + `NeFilterBar` with no renderer and let pilots
  keep their markup; captures every defect class in §3b at a fraction of the
  cost, defers the visible table Logan asked for.
- **Q3 Server list contract.** (a) **Recommended:** gate the query half
  (`parseListQuery`: clamp, sort allowlist, unknown-key rejection, offset or
  cursor) and ship the envelope as an ungated default with adapters — the half
  the defects live in is the half `foundation:check` and the Drizzle lint can
  see. (b) Gate both halves — one shape fleet-wide, ~40 routes of envelope churn
  for no measured defect reduction. (c) Cursor-only — best for live/large data,
  breaks "page 3 of 12" admin pagers. (d) No contract; adapters forever.
- **Q4 Wave-1 scope.** (a) **Recommended:** wave 1a = collections core (table,
  pager, `useCollection`), wave 1b = feedback + format + adoption machinery,
  pilots in wave 2 — table first, as asked, bounded. (b) Format + feedback
  first, collections in wave 2 — proves the adoption machinery on cheap
  components (228 formatter + 133 empty-state + 161 chip consumers) before the
  table bets on it. (c) Table only — every pilot re-hand-rolls state panels and
  formatters. (d) Everything in §4a including `page` — blocks on the shell
  design pass.

## 8. Issue plan

File after §7 with `--body-file`; labels discovered per repo with
`gh label list` at filing; URLs recorded here once filed.

| Repo                                                                               | Issue                                                                                                                                | Wave | URL |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---- | --- |
| narduk-libs                                                                        | Umbrella: app-tier component family (this plan) — `enhancement`, `area:foundation`, `P1-high`                                        | 0    |     |
| narduk-libs                                                                        | List-query contract + `parseListQuery`/`listResponse`; migrate the three internal list endpoints                                     | 0    |     |
| narduk-libs                                                                        | `format` output                                                                                                                      | 0    |     |
| narduk-libs                                                                        | `collections` core with the wave-1a gate                                                                                             | 1a   |     |
| narduk-libs                                                                        | `feedback` + `NeFilterBar` + `NeCollectionList`; core `App*` aliases with expiry                                                     | 1b   |     |
| narduk-libs                                                                        | **Bug:** generator omits `design-system`/`nuxt-ui` capability packs (`generate.ts:528`) and pins neither narduk-ui nor narduk-charts | 0    |     |
| narduk-libs                                                                        | `scripts/check-component-surface.mjs` + consumer-fixture subpath assertion                                                           | 0    |     |
| narduk-libs                                                                        | eslint `no-shadowed-shared-component`, `prefer-shared-collection` (family-gated)                                                     | 1b   |     |
| narduk-libs                                                                        | NE Base cards for the family (`design-system-build`)                                                                                 | 1b   |     |
| narduk-libs                                                                        | README guardrail amendment: two-tier styling contract; shell token preset as the bridge (#119)                                       | 0    |     |
| company-hq                                                                         | D-WEBFOUND-2 amendment recording Q1–Q4; `foundation:check` items (#628 follow-up); fleet tracker rows (#629)                         | 0    |     |
| operator-portal, pacc-trac, stonx                                                  | Pilot migration issues (C6) with per-repo scale test and rollback thresholds                                                         | 2    |     |
| been-sober-for, bluebonnet-status-online, austin-texas-net                         | Reconcile shadowed Auth\*/MapKit copies (build-level check first)                                                                    | 3    |     |
| narduk-nvr, papa-everetts-pizza, lakestat-us, x-event-recap, farm-analytics, stonx | Unbounded list routes → `parseListQuery`                                                                                             | 3    |     |

## 9. Risks

- **Adoption, again.** The mechanism is §4a's pin wave plus §4d; if the surface
  check, lint, and `foundation:check` items slip, the family becomes a second
  `AppEmptyState`. Wave 1b is not done until §4d.1–3 exist, and wave 3 is not
  done until the bump PRs are merged.
- **Nuxt UI churn.** `UTable`'s API has already moved under stonx twice (#39,
  #313); the range test in wave 1a and a declared peer range bound the exposure.
  If `UTable`'s slot model blocks reflow, fall back to Q2(b) for the reflow
  renderer only — decided during C3.
- **Home choice consequences.** Q1(a) ties the family to a package that does not
  exist yet and whose rail waits on a design pass (the components need not);
  Q1(c) breaks narduk-ui's posture and the status apps' pins; Q1(b) adds release
  cost. Each is stated in §7 rather than hidden.
- **Two styling tiers** until the shell preset lands: app-tier components use
  Nuxt UI semantic classes only.
- **Big consumers.** stonx (18 surfaces, its own 180/300 LOC file-size budget)
  and pacc-trac (27) migrate table-by-table; the `adapter` option and
  `mobile: 'scroll'` exist so neither changes behaviour to adopt.
- **Survey staleness.** Seven premises in the lane briefs or lane outputs were
  wrong at verification time (operator-portal's tables already consolidated;
  pacc-trac `main` not a workspace; no `AppDataTable` in control-plane;
  narduk-family-location gone; stonx 18 not 10 surfaces; harmony on `UTable` not
  raw; operator-portal's JSON mobile field). Lanes re-verify live.

## 10. Sources

- Lane reports:
  [`components-library-evidence-2026-09-11/lanes/L0..L8`](./components-library-evidence-2026-09-11/)
  (35 JSON + 35 Markdown; SHAs inside) and the adversarial review at
  [`critique/critique.md`](./components-library-evidence-2026-09-11/critique/critique.md).
- company-hq `DECISIONS.md` § D-WEBFOUND-2 (2026-09-04);
  `strategy/web-foundation-libs-plan.md` §3d, §4, §8;
  `Config/web-foundation-status.json`; `Config/portfolio-products.yaml`.
- narduk-libs `docs/proposals/narduk-shell.md` (#119);
  `packages/design/narduk-ui/README.md` guardrails; `AGENTS.md` § Validation and
  § Library-first fixes.
- Estate rules applied: `AGENTS.md` (agent-infrastructure) data-path performance
  contract, survey-claims-are-hypotheses, policy enforcement declarations,
  issue-label conventions.
