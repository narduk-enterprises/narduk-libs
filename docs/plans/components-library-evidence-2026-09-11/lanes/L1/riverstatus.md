# narduk-enterprises/riverstatus — component survey (L1)

SHA `b8b0201` (main). Nuxt 4.4.8, Tailwind 4, no direct `@nuxt/ui` dep but full
Nuxt UI access transitively via `@narduk-enterprises/narduk-core/nuxt`
(UIcon/ULink/UButton/UInput/UFormField/USelect/UForm/UPagination/UApp all in use
— `apps/web/nuxt.config.ts:110`). narduk-ui, narduk-charts, narduk-mapkit-nuxt,
narduk-seo, narduk-analytics, narduk-uploads all present; no narduk-auth. No
legacy template-layer dependency.

## Most reusable hand-rolled things

1. **RiverUnavailablePanel** —
   `apps/web/app/components/river/RiverUnavailablePanel.vue` (19 LOC, **14
   consumers** — the widest reuse in the app). Title + message +
   `tone: error|neutral|warning` panel shown wherever a data section is empty or
   failed. Strong candidate to verify against/replace with `AppEmptyState`. A
   shared version must cover: tone variants, no-icon-required layout, and being
   embeddable inside arbitrary panel/card wrappers (all 14 consumers are
   different parent shapes).
2. **RiverFreshnessBadge** —
   `apps/web/app/components/river/RiverFreshnessBadge.vue` (90 LOC, 4
   consumers). Already composes `NsFreshnessChip` for the freshness axis — good
   adoption, not a dup. But its flood-severity axis
   (action/minor/moderate/major/record flood) falls back to a hand-rolled
   `.rs-pill` because `NsFreshnessChip` can't express severity. Real product
   gap: a generic status/severity badge family, not a freshness dup.
3. **RiverRiversResults** —
   `apps/web/app/components/river/RiverRiversResults.vue` (67 LOC, 1 consumer).
   Server-paginated card grid: "Showing X-Y of Z" + `UPagination`, backed by a
   real `limit/offset/sort/q` API contract (`server/api/v1/rivers.get.ts`). This
   is the closest thing to a "table" in the app — see Table story below.
4. **RiverRiversFilterSidebar** / **RiverStatesFilterControls** —
   `apps/web/app/components/river/{RiverRiversFilterSidebar,RiverStatesFilterControls}.vue`
   (86 + 64 LOC, 1 consumer each). Two independently hand-rolled facet-filter
   sidebars for the rivers and states browse pages. narduk-libs ships no
   filter/search-bar component.
5. **SearchPanel** — `apps/web/app/components/river/SearchPanel.vue` (142 LOC,
   **0 consumers found**). Sizeable hand-rolled search bar with no
   `<SearchPanel` tag usage anywhere in `app/`. Likely dead code superseded by
   the filter sidebars above — worth a live check, flagged here rather than
   asserted dead.
6. **RiverHomeMetricStrip** —
   `apps/web/app/components/river/RiverHomeMetricStrip.vue` (32 LOC, 1
   consumer). Icon + label + value + detail KPI tiles with tone variants,
   homepage only. No shared KPI/stat-tile component exists.
7. **RiverHomeConditionTabs** —
   `apps/web/app/components/river/RiverHomeConditionTabs.vue` (207 LOC).
   Hand-rolled tabs; narduk-core ships `AppTabs` but it has **zero** consumers
   app-wide.
8. **GaugeObservationList** —
   `apps/web/app/components/river/GaugeObservationList.vue` (33 LOC, 1
   consumer). The app's actual **history surface** (USGS/NWPS gauge observation
   readings). No sort, no pagination, no search — just renders whatever the
   server already returned.
9. Card family: **RiverRiverCard** (93 LOC, 2 consumers), **RiverGaugeCard**
   (118 LOC, 3 consumers), **RiverStateCard** (40 LOC, 2 consumers) — three
   independent single-entity summary cards feeding the card-grid list surfaces.
10. **riverstatus.ts** utils — `apps/web/app/utils/riverstatus.ts` (252 LOC).
    Houses `formatNumber`, `formatTimestamp`, `formatObservationValue`,
    `getFreshnessLabel`, `getFloodCategoryLabel` — date/number formatting not
    split into dedicated files.

## Table story

**There is no table anywhere in this app.**
`grep -rln '<UTable|<table|role="table"'` across `apps/web` returns zero hits,
and no `grid-cols-` header+rows fake table exists either. Every "list" surface
(rivers, gauges, states, observations) renders as a **card grid**
(`RiverRiversResults.vue` → `RiverRiverCard`) or a **plain stacked detail list**
(`GaugeObservationList.vue`).

What a shared collection/table component needs to cover here:

- **Card-grid render mode**, not just rows — `RiverRiversResults.vue` is
  card-grid-as-list, and that's the dominant pattern in this family.
- **Real server pagination**: `server/api/v1/rivers.get.ts`
  (`apps/web/server/api/v1/rivers.get.ts`) takes
  `limit`/`offset`/`sort`/`q`/`state`/`source`/`flood`/`forecast` and returns a
  consistent envelope
  `{ ok, data, error, meta: { generatedAt, pagination: { limit, offset, total } } }`
  (`server/utils/api-envelope.ts:14`, `createPaginatedEnvelope`). Same envelope
  reused by `gauges.get.ts` and `search.get.ts`.
- **URL-state sort**: a binary toggle (`gauges|name`) driven by
  `route.query.sort`, rendered as a `UButton`/`NuxtLink`, not a sortable column
  header (`RiverRiversPage.vue:232`).
- **History rows with zero interactivity**: `GaugeObservationList.vue` has real
  time-series data (parameter, value, observedAt) but no sort/paginate/search at
  all — a shared table used for history would need a sane default here even when
  the app hasn't asked for those features.
- Mobile: not separately measured (`not measured`) — no distinct mobile branch
  found in the card-grid or list components; layout is likely
  responsive-CSS-only.

## What's broken (issues/PRs, UI-relevant only)

- PR **#64** "Improve RiverStatus mobile UI flows" (merged) — mobile UI fixes
  across the app.
- PR **#57** "Improve RiverStatus UI filter surfaces" (merged) — touches exactly
  the filter-sidebar pattern called out above.
- PR **#28** "Fix gauge observation history controls" (merged) — touches
  `GaugeObservationList`'s surface directly.
- PR **#65** "Fix RiverStatus light and dark theme surfaces" (merged).
- PR **#19** "Add RiverStatus comp guardrails and UI polish" (merged).
- Issue **#96** "ci / E2E (2) and E2E (3) fail on main itself" (open) — CI
  infra, not UI behavior; excluded from the table above.

Tests touching these patterns:
`apps/web/tests/server/narduk-river-query.test.ts`,
`apps/web/tests/server/gauge-discovery-query.test.ts`,
`apps/web/tests/e2e/riverstatus-interactions.spec.ts`,
`apps/web/tests/e2e/riverstatus-regression.spec.ts`.
