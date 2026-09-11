# Components library backlog — the shared component suite, one item at a time

Status: **draft for Logan's decision round (2026-09-11)**. Replaces the
2026-09-11 usage-driven plan (narduk-libs #246) in place; that version's
per-repository tables and line counts live on in git history and in its
[evidence folder](./components-library-evidence-2026-09-11/) (lanes L0–L8 plus
the critique), which every count and prior-art claim below comes from, re-read
live in the three pilots at the SHAs named in §3.

## 1. Goal

Build one shared, app-tier component suite for every Nuxt app in the estate, so
that no app writes its own table, empty state, status chip, formatter, page
header, KPI tile, filter bar, confirm dialog, card list, form page, admin page
or shell again. The suite is a numbered backlog, most important first; each item
is one narduk-libs PR, built one at a time and adopted by its first pilot before
the next item starts (Logan, 2026-09-11: build them one at a time and integrate
as we go). Only the three foundations (items 1–3) are batched. The adoption
machinery — grouped version bumps, `foundation:check` items, lint rules,
generator wiring, NE Base cards — sits in the backlog where it belongs, not in a
separate phase. Ordering rule, applied in this precedence: (1) foundations
everything else needs; (2) what all three pilots need most; (3) recurring bug
classes the item removes by construction; (4) how widely the estate uses the
pattern (evidence-folder counts, quoted per item as `apps/files`).

**Standing decisions kept** (company-hq DECISIONS.md, D-WEBFOUND-2 and its
2026-09-11 amendment): the suite lives in `narduk-shell`
(`packages/design/narduk-shell`, `Ne*` prefix provisional under D-WEBFOUND-2
Q7's parked renames), it wraps Nuxt UI rather than reimplementing it, and list
routes use the `parseListQuery` contract. The amendment's Q4 answer (table-first
waves) is superseded by this backlog. narduk-core pins `@nuxt/ui` 4.6.0 exactly,
which already ships the Pro-era primitives the suite wraps (`UEmpty`, `UTable`,
`UPageHeader`, `UDashboardSidebar`, `UPageHero`, `UPageCTA`, `UPagination`,
`UModal`, `UBadge`, `UForm`).

**Standard done-when** (every component item; machinery items state their own):

1. README section in `packages/design/narduk-shell/README.md` — props, slots,
   events, one example.
2. A mount test (`@vue/test-utils`) and an SSR test (`renderToString` in
   vitest's node environment, no `document`; pattern:
   `packages/design/narduk-charts/src/ssr.test.ts`).
3. An NE Base card (`data-design-card`) in `design-system-build/app/app.vue`,
   pushed through `/design-sync`.
4. A changeset; published to GitHub Packages; installable — proven by the
   consumer fixture's subpath-resolution tier (item 1), not by a green build.
5. The item's first pilot has an adoption PR open with an exact pin (that PR is
   the app's own work; this plan and its evidence lanes were read-only in every
   app repo).

Dropped or merged, one line each: `NeKpiBand` folds into the KPI item;
`NeSectionHeader` into the page-header item; `NeSearchInput` into the filter
bar; `defineColumns` into the table; v1's `NeCollectionList` becomes
`NeCardList`; pacc-trac's `DenseListPager` becomes `NePager density="dense"`;
toasts are not wrapped (Nuxt UI `useToast` is enough); tabs and breadcrumbs are
not wrapped (`UTabs`/`UBreadcrumb` direct; breadcrumbs live inside
`NePageHeader`); charts, maps and auth screens are adopted, not rebuilt (item
22); narduk-ui's `Ns*` status instruments stay in narduk-ui for status apps.

## 2. Backlog

Each item: what it is with an API sketch, why it sits here (one line), what it
depends on, which pilot adopts it first, and its issue link (filed in order once
Logan approves the order).

### 1. `narduk-shell` package skeleton (foundation)

- **What:** `packages/design/narduk-shell` — a Nuxt module that registers each
  export with an explicit `addComponent` (never `addComponentsDir`, so an
  app-local `NeStatePanel.vue` shadows loudly instead of silently), subpath
  exports (`.`, `./format`, `./theme.css`), a `files` allowlist, peers
  `nuxt >=4.0.0`, `vue >=3.5.0`, `@nuxt/ui` matching narduk-core's pin, README,
  first changeset. Also generalises the consumer fixture: today
  `scripts/release-packages.mjs` resolves every `exports` subpath only for
  narduk-testkit; this item makes that tier run for every packed package with an
  `exports` map (narduk-ui and narduk-charts get their first subpath proof).
- **Why here:** nothing ships without a home, and the fixture tier is what makes
  done-when 4 a proof rather than a claim.
- **Depends on:** —.
- **First pilot:** install only; operator-portal takes the dependency with
  item 5.
- **Issue:** —

### 2. Theming through Nuxt UI (foundation)

- **What:** the narduk-shell `app.config` preset plus `theme.css`: NE tokens
  (the structural half of PACC·TRAC's set per `docs/proposals/narduk-shell.md` —
  surfaces, ink, radius, shadow, type scale, the `accent`/`structure` brand
  hooks) mapped onto Nuxt UI's `--ui-*` variables, so every `U*` and `Ne*`
  component themes from one sheet. Styling contract: components read tokens,
  never hardcode a colour, radius, shadow or font (narduk-ui guardrail 3,
  extended to the suite). Contrast regression test using the class that failed
  in operator-portal#238. Extends the NE Base Foundations card.
- **Why here:** every component after this inherits its look from here; theming
  after the fact is how "5 redesigns that never redesigned" happens.
- **Depends on:** 1.
- **First pilot:** operator-portal (its `op-*` palette maps onto the preset).
- **Issue:** —

### 3. Component surface check + NE Base card mechanism (foundation)

- **What:** `scripts/check-component-surface.mjs`, wired into
  `quality:artifacts`: for every component narduk-shell registers and every
  `format` export, require a README heading, a mount test, an SSR test and a
  `data-design-card` in design-system-build. Scoped to narduk-shell at first
  (the existing packages backfill in item 22, then join the check). Adds the
  card template and a `design-system:build` fixture so each later item ships its
  card with the component.
- **Why here:** done-when 1–3 are a claim until something fails when they are
  missing; today nothing in narduk-libs checks any of them.
- **Depends on:** 1.
- **First pilot:** none (narduk-libs CI).
- **Issue:** —

### 4. Generator: lint packs and narduk-shell by default (machinery)

- **What:** `create-narduk-app`: add the `design-system` and `nuxt-ui` packs to
  the four hardcoded at `generate.ts:528`; put narduk-shell in the default
  module list with an exact pin in `manifest.ts` (changeset per
  `check-generator-release-plan.mjs`); add a `charts` capability that pins
  narduk-charts; extend the consumer smoke so the generated app renders one
  `Ne*` component the way it renders `LayerAppHeader` today.
- **Why here:** every new app must start on the suite before the first component
  ships, or new local copies keep appearing faster than we remove them.
- **Depends on:** 1, 2.
- **First pilot:** the next generated app; not a pilot.
- **Issue:** —

### 5. Formatters — `narduk-shell/format`

- **What:** framework-free, `Intl`-based, SSR-stable:

  ```ts
  formatDate(v, { timeZone, locale?, style? }); formatDateTime(v, opts); formatRelative(v, { now, timeZone })
  formatDuration(ms, opts); formatNumber(n, opts); formatCompact(n); formatPercent(n, { digits })
  formatMoney(n, { currency, timeZone? }); formatQuantity(n, { unit })
  createFormatters({ timeZone, locale }) // one bound set per app; no Date.now() or host-TZ defaults
  ```

- **Why here:** first in all three pilots' own orders; 14 apps/21 files/228
  consumers; removes the timezone/SSR class (operator-portal#262 and #268,
  stonx#674 and #675, riverstatus's hand-rolled DST arithmetic in
  `app/utils/riverstatus.ts`).
- **Depends on:** 1, 3.
- **First pilot:** operator-portal (6 files), then stonx
  (`app/utils/formatters.ts`, 21 formatters, 134 consumers — the reference for
  the API), then riverstatus.
- **Issue:** —

### 6. Grouped version bumps + `foundation:check` "shared UI pinned" (machinery)

- **What:** the generator and the shared-ci template emit one Dependabot group
  for `@narduk-enterprises/*`; narduk-app-tools gains `foundation:check` item 8
  `shared-ui-pinned` (narduk-shell, narduk-ui and narduk-charts present as exact
  pins wherever the app has UI; `not-applicable` for API-only apps), with its
  `tests/foundation/item-8-*.test.ts`.
- **Why here:** the first shippable component (5) is the first thing apps will
  drift on; bumps must be one PR per app, not one per package.
- **Depends on:** 5.
- **First pilot:** operator-portal, then the other two.
- **Issue:** —

### 7. `NeStatePanel` — empty · loading · error · blocked · absent

- **What:** wraps `UEmpty` (empty/absent), `USkeleton` (loading) and `UAlert`
  (error):

  ```vue
  <NeStatePanel
    :state="status"
    title="No runners"
    message="…"
    icon="i-lucide-server"
  >
    <template #action><UButton>Add one</UButton></template>
  </NeStatePanel>
  <!-- state: 'empty'|'loading'|'error'|'blocked'|'absent', or bind useAsyncData's status;
       gaps: string[] and unblocksOn/unblocksHref ported from operator-portal StatePanel -->
  ```

- **Why here:** second in all three pilots' orders; 16 apps/25 files/133
  consumers; forecloses the "unknown rendered as zero" class
  (operator-portal#183, #162, #100, #21; open #282 asks for exactly this).
- **Depends on:** 2, 3. Supersedes narduk-core `AppEmptyState` (decision D4).
- **First pilot:** operator-portal (`StatePanel.vue`, 89 LOC, 22 consumers — a
  port), then stonx (`CommonEmptyState`, 46 consumers), riverstatus
  (`RiverUnavailablePanel`, 14).
- **Issue:** —

### 8. `NeStatusBadge`

- **What:** wraps `UBadge`; `tone × label` with word-safe text and ARIA:

  ```ts
  <NeStatusBadge tone="ok|warn|error|info|neutral|pending" :label />
  const flood = defineStatusMap<FloodStage>({ action: ['warn', 'Action'], major: ['error', 'Major'] … })
  <NeStatusBadge v-bind="flood(stage)" />
  ```

- **Why here:** 19 apps/26 files/161 consumers, the second-widest pattern;
  removes the duplicated tone maps that produced operator-portal#156 twice.
  narduk-ui's `NsFreshnessChip` stays for freshness in status apps.
- **Depends on:** 2, 3.
- **First pilot:** operator-portal (four chips → one), then riverstatus (the
  severity axis `RiverFreshnessBadge` hand-rolls), stonx.
- **Issue:** —

### 9. `NePageHeader` + `NeSectionHeader`

- **What:** wraps `UPageHeader` + `UBreadcrumb`:

  ```vue
  <NePageHeader
    title="Runners"
    description="…"
    :breadcrumbs="[…]"
    eyebrow="Infrastructure"
  >
    <template #actions><UButton>New</UButton></template>
  </NePageHeader>
  <NeSectionHeader
    title="Recent"
    :count="12"
  ><template #actions/></NeSectionHeader>
  ```

- **Why here:** all three pilots need it and it is mechanical (7 apps/7 files in
  the estate count, but stonx alone has 19 + 6 consumers and operator-portal
  uses the CSS pattern on 21 of 25 pages).
- **Depends on:** 2, 3.
- **First pilot:** stonx (`AppPageHeader`, `MarketSectionHeader`), then
  operator-portal, riverstatus.
- **Issue:** —

### 10. List-query contract — `parseListQuery` + `listResponse`

- **What:** zod schemas in `contracts/narduk-platform`, helpers in narduk-core's
  server utils (the standing home; the suite renders it, it does not own it):

  ```ts
  const q = parseListQuery(event, {
    sortable: ['name', 'updatedAt'],
    filters: zodObject,
    maxLimit: 100,
    mode: 'offset' | 'cursor',
  })
  // limit clamped ≤ maxLimit, sort ∈ allowlist as '<key>:<asc|desc>', q, allowlisted filters, .strict() — unknown keys rejected
  return listResponse(items, { total, query: q }) // { items, total|null, limit, offset|nextCursor, sort, q }
  ```

  Contract tests: clamp, allowlist, unknown-key rejection, statement ceiling.
  Migrates narduk-libs' own three list endpoints (narduk-auth users and
  notifications, narduk-ai system-prompts).

- **Why here:** the biggest bug class with the least UI risk — stonx#208, #188,
  #189, #217, #221, #190, #191 (and PR #251) are all query parsing;
  riverstatus's per-route zod schemas silently strip unknown keys; the
  collection stack (11–12) needs one server shape underneath it.
- **Depends on:** —.
- **First pilot:** stonx (`server/utils/query.ts` three shapes → one; screener
  keeps its 500 cap via `maxLimit`; watchlist and big-movers gain a limit), then
  riverstatus (3 routes). Not operator-portal (D-FRESH-1 read model, no list
  routes).
- **Issue:** —

### 11. `useCollection<T>()` + `NePager`

- **What:**

  ```ts
  const c = useCollection<Runner>({ fetch: (q) => $fetch('/api/runners', { query: q }), sortable, limit: 25, syncQuery: true })
  // single-flight, stale-scope cancel, debounced q, page resets when q/filters change, limit clamped;
  // adapter: (raw) => ListResponse<T> for routes not yet on item 10
  <NePager v-model:state="c.state" density="dense" :to="(page) => ({ query: { page } })" />  // wraps UPagination; :to gives real hrefs
  ```

- **Why here:** removes search-after-page by construction (stonx#219, #218, #5;
  operator-portal#279 tap targets); pagination is in 9 apps/11 pagers and every
  one hand-rolls the state machine.
- **Depends on:** 10, 7. Prior art: pacc-trac `usePagedList` + `DenseListPager`
  (tested, clamp-on-mutation solved), nvault cursor list, stonx
  `useGameTradeRouteQuery`.
- **First pilot:** stonx, then riverstatus (rivers list, `:to` mode for SEO).
  Not operator-portal now.
- **Issue:** —

### 12. `NeDataTable<T>`

- **What:** wraps `UTable`:

  ```ts
  const columns = defineColumns<Runner>([{ key: 'name', label: 'Name', sortable: true, primary: true }, { key: 'state', cell: NeStatusBadge }])
  <NeDataTable :columns :rows mode="client" mobile="reflow" v-model:state="state" />
  <NeDataTable :columns :collection="c" mode="server" mobile="cards" />   // state owned by useCollection
  // mobile: reflow (default — operator-portal's contract: same DOM, one cell per line at ≤1000px, no horizontal scroll) | cards | scroll | hide
  // sort is wired to state in both modes; empty/loading via NeStatePanel; header and cell slots, never h()
  ```

- **Why here:** the estate's largest surface (15 apps/71 files/15,852 LOC) and
  three bug classes at once — mobile overflow (operator-portal#167, #168, #236,
  #136, #280; stonx#78 regressed, 12 of 18 tables still scroll), inert or
  triplicated sort (operator-portal#330, #201; stonx#313, #39), and search after
  page via item 11.
- **Depends on:** 11, 7, 8. Prior art: operator-portal `CollectionTable.vue`
  (421 LOC, 17 consumers, e2e specs 09/21 plus unit test — port the reflow
  contract verbatim), pacc-trac `Ledger/Table.vue`, hydrogen `SimpleTable.vue`.
- **First pilot:** operator-portal (client mode; keeps reflow, gains sort), then
  stonx (18 surfaces; inline editing and column visibility preserved).
  riverstatus has no table.
- **Issue:** —

### 13. Enforcement: lint rules + `foundation:check` "no local copy" and "list routes" (machinery)

- **What:** eslint-config rules `narduk/no-shadowed-shared-component` (an
  app-local component whose registered name matches a narduk-shell, narduk-core,
  narduk-ui, narduk-charts or narduk-auth export) and
  `narduk/prefer-shared-collection` (a native `<table>` or bare `UTable` outside
  `NeDataTable`; `design-system.mjs:88`'s message now points at `NeDataTable`),
  both in the `design-system` pack, warn first; narduk-app-tools items 9
  `no-local-copy` and 10 `list-routes-use-contract`, each with its test.
- **Why here:** the rules need a stable export list (1–12) and the table to
  point at; before that they would only nag.
- **Depends on:** 12, 10, 6.
- **First pilot:** operator-portal, then stonx, riverstatus (as warnings; the
  audit skill flags what they miss — §4).
- **Issue:** —

### 14. `NeFilterBar` + `NeSearchInput`

- **What:** chips, facets and tabs with the APG tablist keyboard model, a
  debounced search input, an active-filter summary and reset:

  ```vue
  <NeFilterBar
    v-model:state="c.state"
    :facets="[{ key: 'state', label: 'State', options }]"
    search-placeholder="Search runners"
  />
  <NeSearchInput v-model="q" :debounce="250" />
  // standalone; values flow through item 10's filters schema
  ```

- **Why here:** 18 apps/31 files; the URL-sync and debounce that no stonx filter
  bar has today; filter values validated by the contract close the raw-text
  interpolation class (stonx#217, #221, #190, #191).
- **Depends on:** 11. Prior art: operator-portal `FilterBar.vue` (173 LOC, 8
  consumers — the chips half ports), riverstatus's URL-as-source filters.
- **First pilot:** operator-portal (chips half; search input built fresh with
  the table), then stonx, riverstatus.
- **Issue:** —

### 15. `NeKpiTile` + `NeKpiBand`

- **What:** composes `UCard`; values through item 5:

  ```vue
  <NeKpiBand :columns="{ base: 2, lg: 4 }">
    <NeKpiTile label="Open findings" :value="42" :delta="-3" tone="ok" detail="vs last week">
      <template #spark><NardukLineChart … /></template>
    </NeKpiTile>
  </NeKpiBand>
  ```

- **Why here:** 17 apps/27 files/73 consumers, needed by all three pilots;
  closes operator-portal#221, #222, #179, #180. narduk-ui's `NsReadoutTile`
  stays for status apps.
- **Depends on:** 5, 2, 8.
- **First pilot:** stonx (`MetricCard`/`Metric`/`MetricGrid`, 46 refs, sparkline
  not yet composed in), then operator-portal (`SparkTile`, 471 LOC for one
  consumer), riverstatus.
- **Issue:** —

### 16. `NeConfirmDialog` + `useConfirm()`

- **What:** wraps `UModal`; focus trap, Escape and `aria-modal` by construction:

  ```ts
  const ok = await confirm({
    title: 'Close all positions?',
    message,
    confirmLabel: 'Close all',
    tone: 'danger',
    body: TradeSummary,
    props,
  })
  // preventClose while pending; body slot for stonx's trade details; never used for operator-portal's preview-token flows
  ```

- **Why here:** 7 apps/12 modals; stonx alone has 11 call sites across six
  files; operator-portal#134 (declared `aria-modal`, Tab not trapped) is the bug
  class.
- **Depends on:** 2, 3. Supersedes narduk-core `AppConfirmModal` (decision D4).
- **First pilot:** stonx (`CommonConfirmModal` + 5 bespoke), then
  operator-portal (dialog chrome only).
- **Issue:** —

### 17. `NeCard`, `NeCardList<T>`, `NeDetailView`

- **What:** `NeCard` wraps `UCard` (media, title, badge, stat rows, actions);
  `NeCardList` renders the same collection state as the table (`v-model:state`
  or `:collection`, `NeStatePanel` and `NePager` built in) so one page toggles
  cards and table; `NeDetailView` is a key-value panel:

  ```vue
  <NeCardList
    :collection="c"
    :card="RiverCard"
    :columns="{ base: 1, md: 2, xl: 3 }"
  />
  <NeDetailView
    :items="[{ label: 'Stage', value: stage, format: 'quantity', unit: 'ft' }]"
    unavailable-message="No reading"
  />
  ```

- **Why here:** the widest pattern in the estate (22 apps/49 files) but only one
  pilot needs it and its list half needs 11; buoys `StationList` is the cleanest
  density-mode prior art, stonx's 84 card files are too fragmented to extract
  from.
- **Depends on:** 11, 7, 8.
- **First pilot:** riverstatus (three entity cards, two trust panels), then
  stonx (cards mode of the screener). Not operator-portal now.
- **Issue:** —

### 18. `NeAppShell`

- **What:** the sectioned left rail from `docs/proposals/narduk-shell.md` (#119)
  — always-expanded labelled sections, active-route highlight, a drawer only at
  the breakpoint, top and bottom slots — wrapping `UDashboardGroup`,
  `UDashboardSidebar`, `UDashboardNavbar` and `UNavigationMenu`:

  ```ts
  nardukShell: { accent, structure, sections: [{ id: 'ops', label: 'Operations', items: [{ label: 'Overview', to: '/' }] }] }
  <NeAppShell><slot /></NeAppShell>; const sections = useNardukShellSections()
  ```

  Not auth, not routing guards. Gated on a design pass with Logan (#119).

- **Why here:** 18 apps/36 files and Logan's own complaint, but every pilot
  orders it after the smaller items prove the suite in production, and its shape
  is decision D2/D3.
- **Depends on:** 2, 9. Prior art: operator-portal `layouts/default.vue` (668
  lines, Logan's sectioned-rail instruction of 2026-09-03), stonx
  `CommonPageShell` (23 consumers) +
  `AppHeader`/`AppShell`/`AppFooter`/`MobileNav`, narduk-core `Layer*Shell`
  (decision D4).
- **First pilot:** stonx (closes stonx#98, #104); operator-portal per D2;
  riverstatus per D3.
- **Issue:** —

### 19. Forms and settings page

- **What:** `NeForm` wraps `UForm` with a zod schema, `loading-auto` submit,
  dirty state and a save bar; `NeFormSection`; `NeSettingsPage` composes
  sections with a sticky save:

  ```vue
  <NeSettingsPage title="Settings" :schema :state @submit="save">
    <NeFormSection title="Profile"><UFormField name="name"><UInput v-model="state.name" /></UFormField></NeFormSection>
  </NeSettingsPage>
  ```

- **Why here:** 13 apps/21 files but one pilot; stonx#37, #36, #350 are the bug
  class; narduk-core `AppSettingsProfile` is the overlap (decision D4).
- **Depends on:** 9, 7.
- **First pilot:** stonx (`SettingsContent` + 7 raw `UForm` sites). Not
  operator-portal or riverstatus (no forms).
- **Issue:** —

### 20. Admin page blocks

- **What:** `NeAdminListPage` (header + filter bar + table + pager on one
  `useCollection`), `NeAdminDetailPage` (detail view + actions),
  `NeAdminEditPage` (form); the generator scaffolds an admin list page from them
  under an `admin` capability.
- **Why here:** composed from 9, 12, 14, 17 and 19, so it must be last of the
  page-level blocks; stonx's 23 admin pages are the payoff.
- **Depends on:** 9, 12, 14, 17, 19, 4.
- **First pilot:** stonx. Not operator-portal or riverstatus.
- **Issue:** —

### 21. Marketing sections

- **What:** `NeHero`, `NeFeatureGrid`, `NeCta`, `NeMarketingFooter` — thin
  themed wrappers over `UPageHero`, `UPageFeature`/`UPageGrid`, `UPageCTA`,
  `UFooter`, plus a landing scaffold in the generator.
- **Why here:** no pilot has generic sections (stonx's hero is Three.js,
  riverstatus's are river copy); circuit-breaker's `MarketingPageTemplate` (12
  consumers) is the estate's prior art, so this waits for the new-app path.
- **Depends on:** 2, 9.
- **First pilot:** the generator's landing scaffold and the next new app.
- **Issue:** —

### 22. Backfill what already ships to the suite bar

- **What:** four small PRs under one issue, one per package: narduk-charts
  (`NardukChartStack` has no render test; Scatter and Histogram have no README
  or mount test), narduk-ui (no instrument is mounted in any test),
  narduk-mapkit-nuxt (`AppMapKit` has SSR e2e but no mount test), narduk-auth
  (`Auth*` cards have source-regex tests and no README mention) — README, mount
  and SSR tests, NE Base cards; then item 3's check extends to them. Pilots
  reconcile shadowed copies as they go (stonx `AuthBackground`/`AuthLegalFooter`
  rename out of the `Auth*` namespace; been-sober-for and bluebonnet's
  zero-consumer `auth/*` copies from the evidence folder).
- **Why here:** adoption, not building; nothing in the backlog depends on it,
  and it keeps the surface check honest for everything the suite sits beside.
- **Depends on:** 3.
- **First pilot:** operator-portal and riverstatus already use what ships
  (`AuthLoginCard`, `NardukLineChart`, `AppMapKit`, `NsFreshnessChip`); stonx
  uses narduk-charts and nothing else.
- **Issue:** —

## 3. Pilots

All three are Cohort 1 (focus: now). Other apps adopt after the pilots; they are
not scheduled here. pacc-trac is not a pilot; its code and lane report
(`lanes/L4/pacc-trac.md`) are prior art. Each list was produced by reading the
app at the SHA shown, re-verifying v1's lane report live; every v1 claim
reproduced except the two noted.

### stonx — `d50ad729600a67d09e5ec56d78bb25f73044053e`

Most UI in the cohort; no narduk-core, narduk-auth or narduk-ui dependency;
narduk-charts already adopted. Adopts, in order: **5** formatters (134
consumers, pure swap) → **7** state panel (empty slice, 46 consumers) → **9**
page header (19 + 6 consumers) → **15** KPI tile (3 files, 46 refs) → **16**
confirm dialog (11 call sites) → **10** list-query contract (three server shapes
→ one; the 7-issue class) → **11** useCollection + pager → **14** filter bar
(none syncs to the URL today) → **18** app shell (`CommonPageShell` 23
consumers; after the above prove the pattern) → **12** data table (18 surfaces;
inline edit and column visibility kept) → **8** status badge (one consumer,
opportunistic) → **19** forms → **20** admin blocks (23 pages). Not now: **17**
(84 fragmented card files, a `CardGrid.vue` filename collision — design without
extracting from stonx), **21** (bespoke Three.js hero), **22** (nothing to
reconcile beyond the two `Auth*`-named chrome components).

### operator-portal — `fe1192d2d5402634ae740341e1cd33bb6491168a`

D-WEBFOUND-2's designated first migration; internal ops console; read-model
architecture (D-FRESH-1) with no list routes; already on `AuthLoginCard` and
`NardukLineChart` (#224 and #238 are closed, fixed 2026-09-04 — v1 listed them
as open). Adopts, in order: **5** formatters (6 files; #262, #268) → **7** state
panel (`StatePanel.vue` port, 22 consumers; #282) → **8** status badge (four
chips → one; #156) → **12** data table (`CollectionTable` port, 17 consumers,
client mode, gains sort for #330/#201) → **14** filter bar (`FilterBar.vue`
chips half, 8 consumers) → **15** KPI tile (`SparkTile`, 471 LOC) → **9** page
header (CSS pattern on 21 of 25 pages) → **16** confirm dialog chrome only
(#134; the preview-token mutation flows stay bespoke). Not now: **10**, **11**
(no list routes by design), **17**, **19**, **20**, **21** (no cards, forms,
admin CRUD or marketing surface), **18** per decision D2.

### riverstatus — `b8b02014c3ade88faafb98cb363de8f0c290bb29`

Stands in for the status apps built on narduk-ui (pins narduk-ui 0.1.2 exactly;
`NsFreshnessChip`, `AppMapKit` ×7 and `NardukLineChart` already in use); public
top-nav app, no left rail, no tables, no forms, no confirm flows. Nuxt UI
reaches it transitively through narduk-core, so `Ne*` needs no new base
dependency. Adopts, in order: **5** formatters (replaces hand-rolled DST math) →
**10** list-query contract (3 routes; unknown keys currently stripped, not
rejected) → **8** status badge (finishes the freshness/severity split) → **7**
state panel (14 mechanical swaps) → **17** cards and detail view (3 cards, 2
trust panels) → **11** pager (`:to` mode) → **14** filter bar (sidebar and
toggle-row shapes) → **15** KPI tile (one strip) → **9** page header (2
breadcrumbs) → **18** app shell only per decision D3. Not now: **12**, **16**,
**19**, **20**, **21**. v1 called `SearchPanel.vue` dead code; it has one
consumer through a renamed import (`pages/search.vue:5`).

## 4. Guidance for agents

agent-infrastructure PR
[#1392](https://github.com/narduk-enterprises/agent-infrastructure/pull/1392)
adds "Shared Components First" to
`skills/coding-standards/references/developer-guide-web.md` — check narduk-core,
narduk-ui, narduk-charts, narduk-auth and narduk-shell (at whatever items have
shipped) before writing a component; use the shared one; extend it in
narduk-libs when it is close; keep a component local only when it is specific to
that product; promote it into the suite once a second app needs it — with
one-line pointers from `nuxt-cloudflare-build` and `nuxt-cloudflare-audit`, and
audit checklist rule 7.11 that flags local copies of shared components. Item 13
is the machine half of the same rule.

## 5. Decisions

Put to Logan as one multiple-choice round on 2026-09-11; answers recorded here
verbatim and as a dated D-WEBFOUND-2 amendment in company-hq DECISIONS.md.

| ID  | Question                                                                                                                                   | Answer    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| D1  | Approve the backlog order in §2 as written                                                                                                 | _pending_ |
| D2  | `NeAppShell` and operator-portal's 668-line rail: promote it as the reference implementation, scaffold-only, or defer                      | _pending_ |
| D3  | Do status apps (riverstatus) adopt the shell, via a top-nav variant, or keep #119's carve-out                                              | _pending_ |
| D4  | narduk-core's overlapping `App*`/`Layer*` components once the `Ne*` equivalent ships: deprecate and remove next major, alias, or keep both | _pending_ |

Issues: one narduk-libs issue per item, filed in order once D1 is approved and
linked from each item's **Issue** line; the amendment's umbrella issue tracks
them.
