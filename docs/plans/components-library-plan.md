# Components library plan — a usage-driven component family for narduk-libs

Status: **proposal, decisions open (§7)**. Written 2026-09-11 from a read-only
survey of 34 repositories (29 Nuxt apps) plus narduk-libs internals. Evidence:
one JSON and one Markdown report per repository under
[`components-library-evidence-2026-09-11/lanes/`](./components-library-evidence-2026-09-11/),
lane L0 being narduk-libs itself. Every count below was produced by a recorded
command in the lane's JSON (`counts.commands`); every claim carries a path.
Survey claims are hypotheses at execution time — a lane re-verifies live before
mutating anything this plan names.

Nests under company-hq **D-WEBFOUND-2** (2026-09-04): four package families in
narduk-libs, `narduk-ui` + `narduk-shell` as the coded NE design system synced
to NE Base, `foundation:check` as the gate, fleet = estate + clients, incubator
on promotion. This plan does not reopen any of those calls; it fills the gap
they left — the _contents_ of the coded design system above the status
instruments.

## 1. The one-paragraph answer

**No.** narduk-libs has no sortable, paginated table — or any table. `narduk-ui`
(0.1.2) ships tokens and four status instruments; `narduk-core` ships fourteen
thin app components that the fleet has almost never adopted (`AppEmptyState`: 0
uses in 29 apps, 12 local re-implementations). Meanwhile the fleet hand-rolls
**71 table surfaces in 15 apps** (≈15.9k LOC of table-bearing files, ≈5.8k LOC
the lanes judged deletable), with **zero** of them offering sort + pagination +
search together, **12+ incompatible server list shapes**, five different mobile
strategies, and 41 recorded list-UI defects of exactly the classes a shared
component prevents by construction (search applied after pagination, unbounded
lists, sideways scroll on phones, inert sort flags, timezone-dependent
formatting). The recommendation is **not a new library** but a new **app-tier
component family inside the existing `design/` family**, built on Nuxt UI,
shipped with a Nuxt module so every app gets it for free, gated by the same
documentation/test/story presence check narduk-libs currently lacks, and rolled
out on the migration waves company-hq already sequenced. Wave 1 is the
_collections_ set — data table, collection list, pager, filter bar, one
`useCollection` state composable, one server list contract — plus the _feedback_
set (state panel, status badge) and a framework-free _format_ output, because
those three sets account for the majority of hand-rolled UI in every app
surveyed.

## 2. What exists today (narduk-libs, HEAD `54577ac`)

Source:
[`lanes/L0/narduk-libs.md`](./components-library-evidence-2026-09-11/lanes/L0/narduk-libs.md).

| Fact                                                                                                                                                                                                                                                        | Evidence                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 55 shared `.vue` components/layouts across core/auth/analytics/seo/ai/ui/charts/mapkit-nuxt; **5 fully README-documented, 5 mount-tested, 45 with no component-level test**                                                                                 | L0 §1                                                       |
| Three registration mechanisms: `addComponentsDir` with `pathPrefix:false` (core/auth/analytics/seo/ai — a same-named app component shadows silently), `addComponent` (mapkit-nuxt), and **no module at all** (narduk-ui, narduk-charts: manual import only) | L0 §2, `narduk-core/src/module.ts:544-547`                  |
| **`create-narduk-app` never wires narduk-ui or narduk-charts** — neither is pinned in `manifest.ts`; a fresh scaffold is `<UApp><NuxtLayout><NuxtPage/></UApp>`                                                                                             | L0 §10                                                      |
| Two non-interoperable styling systems: `--ns-*` tokens (instruments + charts only) vs the Nuxt UI theme in narduk-core `app.config.ts` (everything else). This already caused operator-portal#238 (AuthLoginCard contrast)                                  | L0 §3, `narduk-auth/tests/auth-login-card-contrast.test.ts` |
| The eslint `design-system` pack bans raw `<table>` ("Use `<UTable>`"), but the generator hardcodes `capabilityPacks` without `design-system`/`nuxt-ui` (`generate.ts:528`), so scaffolded apps never inherit that guardrail                                 | L0 §3, §10                                                  |
| No list/pagination/sort contract in `narduk-platform`; narduk-libs' own three list endpoints use three shapes (`{users,page,limit,total}`, `{notifications}`, bare array)                                                                                   | L0 §5–6                                                     |
| `require-limit-on-drizzle-list-queries` forces a real `.limit()` on every Drizzle list query — a shared list helper must still make callers supply a bound                                                                                                  | L0 §6                                                       |
| NE Base previews are one hand-authored `app.vue` with 6 cards (4 instruments, foundations, one Nuxt UI card); nothing scans for components                                                                                                                  | L0 §8                                                       |
| Adding a package costs workspace wiring + changeset + full quality gate + an out-of-workspace consumer-fixture install + a generator manifest pin; adding a subpath export to an existing package costs only the changeset and fixture                      | L0 §9, `AGENTS.md` § Validation                             |

## 3. What the fleet actually builds by hand (34 repos, 2026-09-11)

Scope: every web app in `narduk-enterprises` and `narduk-enterprises-clients`
(D-WEBFOUND-2 Q10); `narduk-incubator` and the `loganrenz` personal plane are
out. Four rows are not Nuxt apps (caminoreal = Astro, pnl and viking-pandl =
static, software-delivery = Worker) and one (`narduk-family-location`) no longer
exists in either org. Shallow clones at the SHAs recorded in each JSON. **What
the numbers license:** a pattern instance is a file a lane classified; LOC is
that file's `wc -l` (page files carry non-table code, so table LOC is an upper
bound); "consumers" is `grep -rl '<Name\b'` file counts; defect history is a
40-issue + 40-PR keyword search per repo, titles only. pacc-trac was surveyed on
`main`, which is still the single-app layout — the S1 workspace split lives on
the unmerged `integration/correctify` branch.

### 3a. Pattern ranking (29 Nuxt apps)

| Pattern                         | Apps   | Instances | File LOC   | Consumers | What narduk-libs ships                                         |
| ------------------------------- | ------ | --------- | ---------- | --------- | -------------------------------------------------------------- |
| card_list (collection renderer) | 22     | 49        | 4,735      | 48        | nothing                                                        |
| status_chip_badge               | 19     | 26        | 982        | 161       | `NsFreshnessChip` only (freshness, not status)                 |
| layout_shell_nav                | 18     | 36        | 3,089      | 49        | `Layer*Shell` (unused); `narduk-shell` proposed (#119)         |
| filter_search_bar               | 18     | 31        | 2,387      | 43        | nothing                                                        |
| kpi_stat_tile                   | 17     | 27        | 2,127      | 73        | `NsReadoutTile` (1 app uses it)                                |
| empty_state                     | 16     | 25        | 696        | 133       | `AppEmptyState` (0 uses, 12 copies)                            |
| **table**                       | **15** | **71**    | **15,852** | **108**   | **nothing**                                                    |
| date_time_format                | 14     | 18        | 1,569      | 208       | nothing                                                        |
| form_field_patterns             | 13     | 21        | 2,351      | 10        | Nuxt UI `UForm` suffices                                       |
| map_wrapper                     | 12     | 19        | 4,202      | 25        | `AppMapKit` (7 apps use it — the adoption success story)       |
| chart_wrapper                   | 11     | 16        | 1,937      | 17        | narduk-charts (5 apps use it; 3 apps hand-roll charts instead) |
| pagination_control              | 9      | 11        | 1,270      | 31        | nothing                                                        |
| number_currency_format          | 8      | 8         | 1,381      | 211       | nothing                                                        |
| page_header / section_header    | 7 / 7  | 8 / 9     | 628 / 399  | 58 / 16   | nothing                                                        |
| confirm_modal                   | 7      | 12        | 143        | 46        | `AppConfirmModal` (1 app uses it)                              |
| sort_control                    | 6      | 8         | 390        | 7         | nothing                                                        |

Full table: `merge §2` in the orchestrator's merged summary, regenerable with
`merge_reports.py` from the lane JSON.

### 3b. The table story, in detail

71 surfaces: 27 in pacc-trac, 18 in stonx, 5 in harmony-hot-sauce, 3 each in
harvest-tracker, nvault, papa-everetts-pizza, 2 each in
bluebonnet-status-online, circuit-breaker-online, gonogo, 1 each in buoys,
farm-analytics, hydrogen, lakestat-us, ogpreview-app, operator-portal.

- **Sorting.** pacc-trac: none of 27 support interactive column sort
  ([L4 pacc-trac.md](./components-library-evidence-2026-09-11/lanes/L4/pacc-trac.md)
  §table story). stonx: three independent sort implementations
  (`common/SortableTableHeader.vue`, inline in `ResultsTableDesktop.vue`,
  `PositionTable.vue` — the only one with `aria-sort`). harmony: 5 `UTable`
  uses, none wire `v-model:sorting`. bluebonnet: `sortable:true` column flags
  with no sorting model — **inert**. operator-portal: none; two open issues ask
  for it (#330, #201).
- **Pagination.** Server offset in pacc-trac (`usePagedList`, 14 consumers,
  tested), stonx (3 shapes), circuit-breaker, bluebonnet, float-forecast,
  riverstatus; cursor in nvault and mybo-at-v2; client in stonx leaderboard
  (moved to DB pagination in stonx#5); **none** in harmony, harvest-tracker,
  operator-portal, lakestat (full filtered set returned).
- **Search.** stonx#219/#256: "search filters only the current page" — merged
  fix; the class recurs wherever search is client-side over a server page.
- **Mobile.** Five strategies: horizontal scroll (pacc-trac's global CSS safety
  net `main.css:395-421`, stonx 8+ surfaces despite stonx#78 "No Horizontal
  Scrolling"), hidden columns (stonx), card-list toggles at inconsistent
  breakpoints (nvault `md:` vs `lg:`), semantic reflow with roles preserved
  (operator-portal `CollectionTable.vue:18-25`, the only a11y-reviewed one), and
  nothing at all (harmony: `overflow-hidden` wrappers, unreachable columns on
  phones as an inferred risk).
- **Column types seen everywhere:** text, number, money, date/datetime/relative,
  badge, link, actions, image. papa-everetts had to `eslint-disable` its own
  "use UTable" rule because `UTable` could not right-align `tabular-nums`
  numeric columns
  ([L5 papa-everetts-pizza.md](./components-library-evidence-2026-09-11/lanes/L5/papa-everetts-pizza.md)).
- **Server contracts (§7 of the merge):** at least 12 response shapes across ~35
  list routes. Offset-style dominates — pacc-trac's
  `{ rows, total, limit, offset }` behind `paged=1` is shared by 20 routes;
  riverstatus wraps `createPaginatedEnvelope`; harvest-tracker uses
  `{ items, limit, nextOffset, offset }`; stonx has three. Cursor-style: nvault
  (`cursor, limit`
  - 12-key filter allowlist that rejects unknown keys, typed
    `AuditPageResponseSchema`) and mybo-at-v2 (`after`, `ORG_LIST_LIMIT=200`,
    born from issue #14). **Unbounded**: narduk-nvr members, papa-everetts
    users/menu, lakestat directory, farm-analytics farms, x-event-recap recaps,
    stonx watchlist.
- **Prior art to build from, strongest first:** pacc-trac `Ledger/Table.vue` +
  `usePagedList`
  - `DenseListPager.vue` (hardened, tested, clamp-on-mutation solved);
    operator-portal `CollectionTable.vue` (421 LOC, 17 consumers, 647 LOC of
    e2e/unit tests, reflow a11y); nvault `audit/index.vue` (cursor + filter
    allowlist; no URL state); hydrogen `SimpleTable.vue` (54 LOC — proof a
    `UTable` wrapper can be small); tx-spends `DataTableCard.vue` (personal
    plane, reference only: `manualSorting` + `UPagination` +
    stale-while-loading, no column types). The corpus claim of an
    `AppDataTable.vue` in control-plane is false — that repo has 11 bare
    `<UTable>` uses and no wrapper (L0 §11).

### 3c. Everything else worth extracting

- **State panel / empty state.** operator-portal `StatePanel.vue` (89 LOC, **22
  consumers**, variants empty/blocked/clear/absent), stonx
  `CommonEmptyState.vue` (109 LOC, **46 consumers**), hydrogen `DataState.vue`
  (25 LOC, 10 consumers, unifies loading/error/empty), riverstatus
  `RiverUnavailablePanel.vue` (19 LOC, 14 consumers) — all the same slot as
  narduk-core's unused `AppEmptyState`, and richer than it.
- **Status badge.** pacc-trac's nine chip components (419 LOC, 62 consumers; PR
  #774 tried and did not finish), harvest-tracker `AvailabilityChip`/`CropChip`
  (228 LOC, 14 consumers), operator-portal four small chips, harmony
  `AdminStatusBadge`, mybo-at-v2 `EdgeStatusBadge`.
- **Formatters.** stonx `utils/formatters.ts` (690 LOC, 21 exports, **134
  consumers**), harvest-tracker `almanac-format.ts` (321 LOC, 48 consumers),
  pacc-trac `shared/utils/format.ts` (69 LOC, 36 consumers), been-sober-for
  `sobrietyTime.ts` (issue #7: SSR hydration mismatch from local-time getters on
  the Worker vs the client — the defect class a shared, timezone-explicit
  formatter removes), nvault's hand-copied `Intl.DateTimeFormat` helper.
- **KPI tile.** stonx `Metric*` family (46 refs), farm-analytics
  `PortfolioKpiBand`, austin-texas-net animated `StatCard` + `SeverityRing`,
  operator-portal `SparkTile` (KPI with sparkline), float-forecast four
  tile-grid components, mybo-at-v2 `VesselStateCards`.
- **Filter bar.** 31 instances; stonx alone has four (366/145/56/39 LOC), buoys
  three, farm-analytics `FarmStatusFilters` (accessible segmented filter with
  counts, ready to generalize).
- **Collection list.** buoys `StationList.vue` family (335 LOC, `variant` =
  cards/compact/rows) is the cleanest density-mode renderer and the natural
  sibling of the table (same column/row model, different renderer).
- **Page header.** tprinvest `PageHeader` (21 LOC copied 7×), circuit-breaker
  `MarketingPageTemplate` (268 LOC, 12 consumers).
- **Already shipped, not adopted — delete, don't extract:** been-sober-for
  `auth/{Login,Register, Exchange}*.vue` (606 LOC, 0 consumers) and bluebonnet
  `auth/*` (637 LOC, 0 consumers) collide name-for-name with narduk-auth's
  `AuthLoginCard`/`AuthRegisterCard`/`AuthExchangePanel`; austin-texas-net
  `app/MapKit.vue` (915 LOC) collides with `AppMapKit`. With `pathPrefix:false`
  these are silent shadows or dead code — a build-level check decides which.
- **Charts.** austin-texas-net has two near-identical `vue-chartjs` wrappers
  (454 LOC), hydrogen 277 LOC of inline SVG, lakestat a hand-rolled history
  chart — all `NardukLineChart` cases (narduk-libs#224 territory).

### 3d. Adoption today

`AppMapKit` 7 apps · `NardukLineChart` 5 · `NsFreshnessChip` 3 ·
`AppConfirmModal` 1 · `AppTabs` 1 · `NsReadoutTile` 1 ·
`AppEmptyState`/`AppBreadcrumbs`/`AppCopyButton`/ `AppShareButtons` **0**. Nine
apps still `extends` the retired `narduk-nuxt-template-layer-*`
(austin-texas-net, bluebonnet, circuit-breaker, harmony, llb-cpa, papa-everetts,
tprinvest, float-forecast, ogpreview-app); four have no narduk-libs dependency
at all (pacc-trac, nvault, farm-analytics, earthdata-viewer via vendored `file:`
deps); stonx has charts/analytics/seo but not core. Three client repos carry the
same open tracker for the template-layer exit (circuit-breaker#38, llb-cpa#48,
papa-everetts#75; tprinvest#50 cites harmony#87 as the pattern).

**Lesson the numbers force:** shipping a component is not adoption. narduk-core
has auto-registered `AppEmptyState` in every mandatory install for months and it
has zero consumers while twelve copies exist. The family below therefore ships
_with_ its discovery and enforcement surface (docs, NE Base cards, lint,
`foundation:check`, generator wiring), not before it.

## 4. Target state

### 4a. One app-tier component family, in `design/`

A new set of outputs, prefixed **`Ne`** (Narduk Enterprises; distinct from
instruments' `Ns*`, from narduk-core's `App*`, and from every app's own `App*` —
the prefix is a collision guard, see §3c), composed from Nuxt UI, themed through
the Nuxt UI `app.config` contract, registered by a Nuxt module so no app imports
anything by hand:

| Output                                           | Components / exports                                                                                                                                     | Replaces (evidence)                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `collections`                                    | `NeDataTable<T>`, `NeCollectionList<T>`, `NePager`, `NeFilterBar`, `useCollection<T>()`, `defineColumns<T>()`                                            | 71 tables, 49 card lists, 11 pagers, 31 filter bars |
| `feedback`                                       | `NeStatePanel` (empty · loading · error · blocked · absent), `NeStatusBadge` (tone × label, ARIA), `NeConfirmModal` (moved from core)                    | 25 empty states, 26 chips, 12 confirm modals        |
| `format` (framework-free, like `narduk-ui/core`) | `formatDate/DateTime/Relative/Duration`, `formatNumber/Compact/Percent/Money/Quantity`, all `Intl`-based with an explicit timezone and SSR-stable output | 26 formatter files, 419 consumers                   |
| `page` (wave 3, with `narduk-shell`)             | `NePageHeader`, `NeSectionHeader`, `NeKpiTile`, `NeKpiBand`                                                                                              | 17 headers, 27 KPI tiles                            |

Where it lives is **Q1** (§7). Whichever home wins, the outputs are subpath
exports of one package with one version, the guardrail narduk-ui already states
("one version covers every output").

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
- **Mobile is a prop, default `reflow`.**
  `mobile: 'reflow' | 'cards' | 'scroll' | 'hide'`. `reflow` keeps the DOM and
  roles (operator-portal's a11y-reviewed behaviour, its two e2e specs ported as
  the family's own); `scroll` is the pacc-trac house style for wide ledgers;
  `cards` uses `NeCollectionList` with the same columns; one breakpoint prop,
  never two DOM trees.
- **Every state renders.** `loading` (skeleton rows, stale-while-loading keeps
  the last page dimmed — tx-spends' best idea), `error`, `empty` (all
  `NeStatePanel`), a required `caption` (sr-only by default), `sticky-header`,
  `density`, optional `selectable`, optional `more` bounded-read footer
  (operator-portal's shape) for read-model pages that must not paginate.
- **`useCollection<T>(fetcher, options)`** owns fetching: single-flight,
  coalesced triggers, stale scope cancellation, debounced search (250 ms,
  pacc-trac), clamp page on mutation (pacc-trac's solved edge case), and a hard
  `pageSize` ceiling — the data-path performance contract in `AGENTS.md` applies
  to it verbatim and its scale test (history × live cardinality axes, statement
  ceiling, response bytes, latency budget) is a merge gate, not a nicety.

### 4c. One server list contract (**Q3**)

Recommended shape, generalized from pacc-trac's 20-route
`{ rows, total, limit, offset }` and nvault's allowlist discipline, published in
`contracts/narduk-platform` as zod schemas and used by `useCollection` and by a
server helper pair in narduk-core:

```ts
// query (all optional, all clamped): limit ≤ 100 (route may raise to 500 like stonx screeners)
{ limit, offset } | { limit, cursor }, sort: '<key>:<asc|desc>', q, ...allowlistedFilters
// response
{ items: T[], total: number | null, limit, offset, sort, q }      // offset mode
{ items: T[], nextCursor: string | null, total: number | null }  // cursor mode
parseListQuery(event, { sortable: [...keys], filters: zodObject, maxLimit })
listResponse(items, { total, query })
```

Unknown query keys are rejected (nvault), `limit` is always present (satisfies
`require-limit-on-drizzle-list-queries`), `total: null` is a legal "not counted"
(bounded feeds like stonx big-movers). Existing shapes migrate through a
per-call `adapter` option on `useCollection`, so an app can adopt the table
before it rewrites its routes.

### 4d. What makes it stick

1. **Docs + tests + story or it does not export.** A repo-level check
   (`scripts/check-component-surface.mjs`, run in `pnpm run quality`) fails when
   an exported `.vue` lacks a README section (props, emits, slots), a mount
   test, an SSR render (Workers-safe, like `narduk-charts/src/ssr.test.ts`), and
   an NE Base card — closing the 5/55 documentation and 5/55 test ratio for the
   new family first and the old one on a schedule.
   <!-- enforcement: none yet -->
2. **Lint.** Two additions to `eslint-config`:
   `narduk/no-shadowed-shared-component` (an app component whose registered name
   equals a narduk-libs export is an error — the Auth*/AppMapKit shadows) and
   `narduk/prefer-shared-collection` (raw `<table>`/`<UTable>` in an app file
   warns toward `NeDataTable`; the existing `vue/no-restricted-html-elements`
   message updates). The generator gains the `design-system` + `nuxt-ui` packs
   it already omits (a defect, filed separately). <!-- enforcement: none yet -->
3. **`foundation:check` items** (W5(a), company-hq#628): "no local copy of a
   `Ne*`/`App*`/`Ns*` export" (extends §4 item 4 of the web-foundation contract)
   and "every list route parses with `parseListQuery`". Both start as warnings
   for one wave, then fail. <!-- enforcement: none yet -->
4. **Generator.** `create-narduk-app` pins the family and scaffolds one
   `NeDataTable`-backed admin list page behind the `auth` capability, so a new
   app never starts a table from scratch.
5. **NE Base.** Each component ships its gallery card in `design-system-build`;
   `/design-sync` pushes the family into NE Base per D-WEBFOUND-2 Q3.
6. **Styling contract, stated once.** Instruments stay on `--ns-*`; app-tier
   components theme through Nuxt UI. The `narduk-shell` token preset (#119) is
   the bridge that sets Nuxt UI's `--ui-*` variables from NE tokens, so both
   tiers derive from one accent/structure source and the operator-portal#238
   class cannot recur. narduk-ui's README guardrail 3 is amended to say so.

## 5. Workstreams

| #   | Workstream                                                                                                                                                                              | Owner package                                                           | Depends on        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------- |
| C0  | Decisions Q1–Q4; family skeleton (package or subpaths, Nuxt module, `Ne` prefix, README, check script from §4d.1)                                                                       | design/                                                                 | —                 |
| C1  | List contract + `parseListQuery`/`listResponse` + contract tests + migrate narduk-libs' own three list endpoints                                                                        | narduk-platform, narduk-core                                            | C0                |
| C2  | `format` output (union of stonx/harvest/pacc-trac formatters; SSR-stable; timezone explicit)                                                                                            | design/                                                                 | C0                |
| C3  | `collections`: `useCollection`, `NeDataTable`, `NePager`, `NeFilterBar`, `NeCollectionList`; ports operator-portal's e2e specs and stonx's unit tests; axe baseline from narduk-testkit | design/                                                                 | C1, C2            |
| C4  | `feedback`: `NeStatePanel`, `NeStatusBadge`, `NeConfirmModal` (core re-exports its `App*` names for one N-1 window)                                                                     | design/, narduk-core                                                    | C0                |
| C5  | Discovery/enforcement: lint rules, generator packs + pin + scaffolded list page, `foundation:check` items, NE Base cards                                                                | eslint-config, create-narduk-app, narduk-app-tools, design-system-build | C3, C4            |
| C6  | Pilot migrations: operator-portal (first consumer, D-WEBFOUND-2 Q4), pacc-trac ledger (4 index pages + `usePagedList`), stonx admin tables (3)                                          | apps                                                                    | C3–C5             |
| C7  | Fleet adoption sweep on the W5 groups; delete dead Auth*/MapKit copies; chip and formatter consolidation                                                                                | apps                                                                    | C6                |
| C8  | `page` output with `narduk-shell` (#119): headers, KPI tiles                                                                                                                            | design/                                                                 | shell design pass |

## 6. Sequencing

- **Wave 0 (this week).** C0 after §7 answers; C1 and C2 in parallel — both are
  framework-free and unblock C3. Issues filed per §8.
- **Wave 1 (2–3 weeks).** C3, C4, C5 land behind the §4d.1 check; version
  `0.2.0` of the home package; consumer fixture proves install. **Done-when:**
  `NeDataTable` in server mode passes the ported operator-portal mobile specs
  and the stonx#219 regression (search before pagination) and the scale test;
  `foundation:check` reports the new items as warnings.
- **Wave 2 (pilots, 2 weeks).** C6 — three real apps, three table styles
  (read-model reflow, ledger scroll, admin sort/paginate). Each pilot PR records
  LOC deleted and defects closed; those numbers replace the estimates in §3.
- **Wave 3 (fleet).** C7 rides the existing W5 adoption groups
  (borderwaitstat-us, spacex-ipo, lakestat-us, been-sober-for, harvest-tracker
  first; the template-layer clients as they exit the layer). `foundation:check`
  items flip from warning to failure at the end of this wave.
- **Wave 4.** C8 once the shell's design pass with Logan has happened (#119
  precondition).

Estimated deletable app code from lane estimates: table ≈5.8k LOC, dead auth
copies 1.2k, charts 0.6k, chips 0.5k, KPI tiles 0.5k, empty states 0.3k, filter
bars 0.3k, pagers 0.3k, formatters 0.3k+ — **≈10k LOC across 29 apps**, before
counting the per-page cell/slot code that typed columns remove. Reliability: the
41 recorded list-UI defects fall into seven classes, six of which the contract
removes by construction (search-after-page, unbounded lists, inert sort,
sideways scroll, tap targets under 44 px, timezone formatting); the seventh
(data gaps like pacc-trac#935) is domain.

## 7. Decisions needed from Logan

Put through the structured multiple-choice surface (askme), recommended option
first.

- **Q1 Home for the app-tier family.** (a) **Recommended:** new outputs in
  `narduk-ui` (`/collections`, `/feedback`, `/format`, later `/page`) plus a
  `@narduk-enterprises/narduk-ui/nuxt` module that auto-registers them;
  narduk-core's `shared/*` re-home there with N-1 aliases — one design-system
  package, as D-WEBFOUND-2 Q3 states, at the cost of amending narduk-ui's
  "tokens are the only styling contract" guardrail into a two-tier contract. (b)
  A new package `@narduk-enterprises/narduk-components` in `design/` — cleanest
  isolation and cadence, +1 package of release cost and a generator pin. (c)
  Grow narduk-core's `shared/` directory — zero wiring since core is mandatory,
  but couples UI fixes to the runtime's release and repeats the `AppEmptyState`
  non-adoption unless §4d lands with it.
- **Q2 Table foundation.** (a) **Recommended:** wrap Nuxt UI `UTable` (TanStack)
  — small component, inherits Nuxt UI upgrades, typed columns solve the
  numeric-alignment gap; port operator-portal's reflow a11y behaviour and tests.
  (b) Port operator-portal's semantic `<table>` and add sort/page/search — full
  markup control, but reimplements TanStack and needs a library exemption from
  the estate's raw-`<table>` lint ban. (c) Ship both renderers behind one column
  model from day one — most flexible, roughly 1.5× wave-1 cost.
- **Q3 Server list contract.** (a) **Recommended:** one envelope with offset and
  cursor modes (§4c), pacc-trac's shape generalized, nvault's allowlist
  discipline; existing routes adapt via `useCollection({ adapter })` until
  rewritten. (b) Cursor-only — best for live/large data, but breaks "page 3 of
  12" pagers admin pages use. (c) No contract; adapters forever — fastest start,
  drift continues, `foundation:check` cannot gate lists.
- **Q4 Wave-1 scope.** (a) **Recommended:** collections + feedback + format (§4a
  rows 1–3) with three pilots. (b) Table only — smallest, but every pilot still
  needs a state panel and formatters, so they get hand-rolled again. (c)
  Everything in §4a including `page` — blocks on the shell design pass.

## 8. Issue plan (file after §7; `--body-file`, repo labels)

| Repo                                                                        | Issue                                                                                                                          | Wave |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---- |
| narduk-libs                                                                 | Umbrella: app-tier component family (this plan) — `enhancement`, `area:foundation`, `P1-high`                                  | 0    |
| narduk-libs                                                                 | List contract + `parseListQuery`/`listResponse`; migrate the three internal list endpoints                                     | 0    |
| narduk-libs                                                                 | `format` output                                                                                                                | 0    |
| narduk-libs                                                                 | `collections` output (`NeDataTable` et al.) with the §6 done-when                                                              | 1    |
| narduk-libs                                                                 | `feedback` output; core `App*` aliases                                                                                         | 1    |
| narduk-libs                                                                 | **Bug:** generator omits `design-system`/`nuxt-ui` capability packs (`generate.ts:528`) and never pins narduk-ui/narduk-charts | 0    |
| narduk-libs                                                                 | `scripts/check-component-surface.mjs` (docs + test + SSR + card presence)                                                      | 0    |
| narduk-libs                                                                 | eslint `no-shadowed-shared-component`, `prefer-shared-collection`                                                              | 1    |
| narduk-libs                                                                 | NE Base cards for the family (`design-system-build`)                                                                           | 1    |
| narduk-libs                                                                 | README guardrail amendment: two-tier styling contract; shell token preset as the bridge (#119 cross-ref)                       | 0    |
| company-hq                                                                  | `foundation:check` items for shared-component shadows and list routes (#628 follow-up); DECISIONS.md entry recording §7        | 0    |
| operator-portal, pacc-trac, stonx                                           | Pilot migration issues (C6)                                                                                                    | 2    |
| been-sober-for, bluebonnet-status-online, austin-texas-net                  | Delete or reconcile shadowed Auth*/MapKit copies                                                                               | 2    |
| narduk-nvr, papa-everetts-pizza, lakestat-us, x-event-recap, farm-analytics | Unbounded list routes → contract                                                                                               | 2    |

## 9. Risks

- **Adoption, again.** Mitigation is §4d; if the check script and lint slip, the
  family becomes a second `AppEmptyState`. Wave 1 is not done until §4d.1–3
  exist.
- **Nuxt UI `UTable` limits.** Column alignment, sticky headers, and mobile
  reflow are wrapper responsibilities; if `UTable`'s slot model blocks reflow,
  fall back to Q2 (b) for the reflow renderer only — decide during C3, not now.
- **Two styling tiers.** Explicitly documented and bridged by the shell preset;
  until #119 lands, app-tier components use Nuxt UI semantic classes only (never
  raw palette classes — already linted).
- **Release cost.** Q1 (a) keeps it to a changeset + fixture; Q1 (b) adds a
  package. Either way the `check-generator-release-plan` gate means a generator
  pin needs its own changeset.
- **Big consumers.** stonx (18 surfaces, its own 180/300 LOC file-size budget)
  and pacc-trac (27) migrate table-by-table; the `adapter` option and
  `mobile: 'scroll'` exist so neither has to change behaviour to adopt.
- **Survey staleness.** Six premises in the lane briefs were wrong at execution
  time (operator-portal's tables already consolidated; pacc-trac `main` not a
  workspace; no `AppDataTable` in control-plane; narduk-family-location gone;
  stonx 18 not 10 surfaces; harmony on `UTable` not raw). Lanes re-verify live.

## 10. Sources

- Lane reports:
  [`components-library-evidence-2026-09-11/lanes/L0..L8`](./components-library-evidence-2026-09-11/)
  (34 JSON + 34 Markdown; SHAs inside).
- company-hq `DECISIONS.md` § D-WEBFOUND-2 (2026-09-04);
  `strategy/web-foundation-libs-plan.md` §3d, §4, §8;
  `Config/web-foundation-status.json`; `Config/portfolio-products.yaml`.
- narduk-libs `docs/proposals/narduk-shell.md` (#119);
  `packages/design/narduk-ui/README.md` guardrails; `AGENTS.md` § Validation and
  § Library-first fixes.
- Estate rules applied: `AGENTS.md` (agent-infrastructure) data-path performance
  contract, survey-claims-are-hypotheses, policy enforcement declarations.
