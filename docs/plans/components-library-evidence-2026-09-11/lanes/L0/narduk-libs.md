# L0 — narduk-libs internal survey

Worktree HEAD `54577acf00a7f3b4f69f9292c73a4d61ed43ebe5` (branch
`narduk-libs-component-audit-42182b`), inspected read-only in place. Full detail
in `narduk-libs.json`. Every claim below carries a path.

## 1. Component inventory (55 files scanned)

Dirs: `packages/modules/narduk-core/runtime/app/components` (14),
`narduk-ui/instruments` (4), `narduk-charts/src/components` (11),
`narduk-mapkit-nuxt/.../components` (2), `narduk-auth/app/components` (8) + 2
layouts, `narduk-analytics/app/components` (4), `narduk-seo/app/components` (6),
`narduk-ai/app/components` (1), plus narduk-core/narduk-auth layouts and
`error.vue`.

- **README-documented in full (props/events/slots): 5/55** — `NardukLineChart`,
  `NardukBarChart`, `NardukPieChart`
  (`packages/design/narduk-charts/README.md:108-336`), `AppMapKit`,
  `AppMapKitCallout` (`packages/modules/narduk-mapkit-nuxt/README.md`). **10
  more are name-mentioned only** (analytics/seo/ai admin panels,
  `NsRangeBar`/`NsLevelWell`, `AppBreadcrumbs`). **40/55 have no README mention
  at all.**
- **Unit-tested by a real mount test: 5/55**
  (`NardukLineChart/BarChart/PieChart/CandleChart.test.ts`, `AppMapKitCallout`
  via `narduk-mapkit-nuxt/test/callout-mount.test.ts`). **3 more get SSR-smoke
  coverage only** (`Scatter/Histogram/BrandBackdrop` chart, via
  `narduk-charts/src/ssr.test.ts:21-29` — note `NardukChartStack` is _not_ in
  that import list, so it has zero render-level test coverage anywhere). **2 get
  source-text assertions only, not a mount**
  (`AuthLoginCard`/`AuthRegisterCard`, via
  `narduk-auth/tests/auth-card-autocomplete.test.ts` and
  `auth-login-card-contrast.test.ts`, both `readFileSync` + regex, no
  `@vue/test-utils`). **45/55 have no component-level test at all.**
- `narduk-charts/src/index.ts:6,10-24` explicitly keeps
  `ChartTooltip`/`ChartLegend`/`ChartTooltipDefaultBody` off the public export
  surface ("not semver-stable unless exported here").
- Full per-file LOC/props/emits/slots/Nuxt-UI-composition/`--ns-*` token usage
  is in the JSON's `1_component_inventory.components` array (machine-extracted
  via regex over `defineProps`/`defineEmits`/`<slot>`, spot-checked against
  `NsFreshnessChip.vue` and `AppEmptyState.vue` by hand).

## 2. Registration mechanics — three distinct mechanisms

1. **`addComponentsDir`** (directory scan, auto-registered, `pathPrefix:false`):
   narduk-core (`src/module.ts:544-547`), narduk-auth (`:169-172`),
   narduk-analytics (`:143-146`), narduk-seo (`:371-378`, two dirs), narduk-ai
   (`:94-97`). `pathPrefix:false` means subfolder is invisible to the tag name —
   a cross-module name collision would silently shadow.
2. **`addComponent`** (per-component, auto-registered, flag-gated):
   narduk-mapkit-nuxt only (`src/module.ts:62-70`, behind `options.component`,
   default true).
3. **Plain package, manual import, NOT auto-registered**: narduk-ui and
   narduk-charts. Neither has a `module.ts`. narduk-ui ships raw `.vue` with no
   build (`package.json` `"build": "vue-tsc --noEmit"`; README.md:15-16: "no
   build step — consumers import the exported paths directly"). narduk-charts
   _does_ have a real Vite-lib build (6 entry points, `package.json:9-41,50-51`)
   but is still Nuxt-unaware (`peerDependencies` is `vue` only,
   `package.json:66-68`).

**A new shared family**: cheapest is dropping into an existing module's scanned
dir (zero new wiring, couples release cadence); cleanest is its own Nuxt module
like narduk-mapkit-nuxt. The narduk-ui/narduk-charts path publishes fine but
stays invisible to apps unless someone manually imports it — and per §10,
`create-narduk-app` never does.

## 3. Styling contract — two parallel systems, confirmed footgun

- `--ns-*` tokens (`packages/design/narduk-ui/tokens.css`, 293 lines:
  ink/contrast-floor, accent triplet as the _only_ per-app override,
  live/aging/stale/void status colors, type scale, elevation, radius, spacing,
  breakpoints) are used **only** by narduk-ui instruments and narduk-charts.
- Nuxt UI's own theme (`narduk-core/runtime/app/app.config.ts` +
  `module.ts:580-586`, `ui.colors.primary:'emerald', neutral:'slate'`) is what
  every narduk-core/auth/analytics/seo/ai component actually themes through
  (semantic Tailwind classes like `text-muted`).
- **This already broke production once**:
  `narduk-auth/tests/auth-login-card-contrast.test.ts:1-36` locks the fix for
  operator-portal#238 — `AuthLoginCard.vue`'s `text-muted` cleared AA against
  Nuxt UI's default background but failed (4.17:1) once operator-portal
  repointed `--ui-bg`. The test's own comment: "`narduk-ui/tokens.css` ... is an
  unrelated token set ... not [what] `AuthLoginCard.vue` actually uses." A
  shared table must pick one system deliberately.
- **`eslint-config/configs/design-system.mjs`: a raw `<table>` is banned by
  lint** — `vue/no-restricted-html-elements`:
  `{element:'table', message:'Use <UTable> instead of a native <table>.'}` (same
  array bans button/input/form/label/details/hr/progress/dialog/kbd/svg).
  `better-tailwindcss/no-restricted-classes` also bans raw Tailwind palette
  classes (`bg-emerald-500` etc.) estate-wide. This pack **is** in
  eslint-config's own `defaultCapabilityPresetOrder`
  (`eslint-app-config.mjs:411-418`) — but see §10, it is not actually in what
  get scaffolded.

## 4. `docs/proposals/narduk-shell.md` (150 lines, proposed/not built, narduk-libs#119)

A new `@narduk-enterprises/narduk-shell` Nuxt module: sectioned, always-expanded
left-nav (never icon-only — an explicit Logan rejection, line 9-24) plus a
generalized PACC·TRAC-derived token layer (structural
surfaces/ink/radius/shadow + a 2-color brand hook), composing Nuxt UI, not
forking it. `modules:['@narduk-enterprises/narduk-shell']` +
`nardukShell:{accent, structure, sections:[{id,label,items}]}` →
`<NardukShell><slot/></NardukShell>`. Adopters: operator-portal first, then
been-sober-for/borderwaitstat-us/gonogo, eventually `create-narduk-app`'s
defaults. Explicitly layout-only — no table/list primitives in scope, so it
doesn't compete with a shared table, but a table family would likely sit in the
same "app shell" tier once this lands.

## 5. Contracts — no list/pagination shape exists

`packages/contracts/narduk-platform/src`: zero hits for
`paginat|pageSize|cursor|PageInfo|ListResponse|orderBy` across the whole
package; every `sort` hit is a trivial `Array.sort()` for deterministic output
(`env-catalog.ts:828`, `provision-env-contract.ts:56,273`), unrelated to any API
shape.

## 6. Server-side list helpers — three endpoints, three different shapes

- `narduk-auth/server/api/admin/users/index.get.ts` (58 lines): `{page,limit}`
  zod-validated (default 1/20, max 100) → offset math →
  `{users,page,limit,total}` with a parallel `COUNT(*)`. The most complete
  pattern found.
- `narduk-auth/server/api/notifications/index.get.ts` (33 lines):
  `{unreadOnly,limit}` as raw strings, manually parsed, capped at 100, **no
  page/offset/total**, bare `{notifications}`.
- `narduk-ai/server/api/admin/system-prompts/index.get.ts` (20 lines): **no
  query params**, hardcoded `.limit(500)`, bare array, no envelope.

No shared `parseListQuery`/`buildListResponse` helper exists anywhere (grepped
narduk-core + narduk-auth server trees). The eslint rule
`require-limit-on-drizzle-list-queries`
(`eslint-config/src/rules/server/require-limit-on-drizzle-list-queries.ts`, 347
lines) forces every Drizzle list query (builder chains _and_
`db.query.X.findMany()`, through aliasing) to carry a real, non-undefined
`.limit()` unless it's a PK-single-row or aggregate query — no autofix, by
design. Any shared list helper still has to make callers supply a real bound.

## 7. Testing/quality tooling

- **narduk-testkit's "UI-quality analyzer"** (`playwright/ui-quality.ts` 317L +
  `ui-quality-analyzer.ts` 218L) is a **screenshot-coverage/non-blank checker**,
  not a behavior checker: captures route/element screenshots, then uses `sharp`
  to compute mean brightness + per-channel stdev (catches blank captures) and
  checks counts against a manifest minimum. It does not assert a table sorts or
  paginates correctly.
- **Accessibility helpers** (`playwright/accessibility.ts`, 284L): real axe-core
  WCAG 2.2 AA baseline, text-zoom-overflow, color-alone-state, and
  reduced-motion assertions — genuinely reusable for a new table's e2e suite.
- **journeys** package: declarative demo-flow → tests/screenshots/video
  compiler, not component-unit infra.
- **Histoire stories** cover only 4/11 narduk-charts components
  (Brand/Pie/Bar/Line); Candle/Histogram/Scatter/ChartStack/Legend/Tooltip have
  none.
- **SSR test** (`narduk-charts/src/ssr.test.ts`, 146L, narduk-charts#31):
  renders 7 of 8 public charts through `@vue/server-renderer` with no
  `window`/`document` to prove Workers/Nitro-safety — `NardukChartStack` is
  excluded from it.

## 8. Design-system-build → NE Base previews

`packages/design/design-system-build/app/app.vue` (128 lines) is **one
hand-authored file**; each gallery card is a manually written
`<section data-design-card=... data-group=...>` block with hand-picked fixture
props — nothing scans the workspace for components. Current coverage: 6 cards
total — all 4 narduk-ui instruments, one Foundations card, and one Nuxt UI card
(`UButton`/`UBadge`/`UInput`/`UAlert` only). **Zero narduk-charts and zero
narduk-core/auth/analytics/seo/ai components appear at all.** A new table
component needs a human to hand-write its card.

## 9. Release mechanics

Changesets (`baseBranch:main`, `access:restricted`, independent per-package
versioning). `pnpm run quality` =
`versions:check && release-plan:check && quality:artifacts(format/lint/typecheck/build/test)`.
`.github/workflows/release.yml`: publish only proceeds after
`verify-release-ci.mjs` confirms the exact main SHA already has green required
CI, then publishes and runs `verify-published-packages.mjs` for immutability.
`AGENTS.md:49-50`: every new release must be installable "by a consumer fixture
outside the workspace." `scripts/check-generator-release-plan.mjs` fails
`quality` if any package `create-narduk-app`'s `manifest.ts` pins changed
without a changeset — so a new package/subpath costs: workspace wiring, its own
package.json + scripts + changeset, the full quality gate incl. out-of-workspace
consumer-fixture install, and (only if it should reach new apps) a generator
manifest pin + `generate.ts` change.

## 10. The generator (`create-narduk-app`)

Always wired: `narduk-core`, `narduk-logging`, `eslint-config`,
`narduk-app-tools`, `narduk-testkit`. Optional via `capabilities`:
`ai/analytics/auth/mapkit/seo/uploads` (`manifest.ts:57-62`). **`narduk-ui` and
`narduk-charts` are pinned nowhere in `manifest.ts` and appear nowhere else in
the generator source** — a fresh scaffold gets neither, ever. Scaffolded
`app.vue` is just `<UApp><NuxtLayout><NuxtPage/></UApp>`; `index.vue` is SEO
boilerplate — a blank slate, nothing to extend for tables.

**Surprise**: `generate.ts:528` hardcodes generated apps' `capabilityPacks` to
`['core','correctness','complexity','formatting']` — **`design-system` and
`nuxt-ui` are not included**, despite being in eslint-config's own
`defaultCapabilityPresetOrder`. So the `<table>`-is-banned guardrail from §3
does **not** actually apply to a freshly generated app unless a human adds the
pack by hand. The estate's own generator under-ships relative to its own lint
package's declared defaults.

## 11. Prior art

- **tx-spends `DataTableCard.vue`** (357 lines,
  `~/code-worktrees/tx-spends/private-postgres/apps/web/app/components/shared/DataTableCard.vue`,
  13 consumers): generic `<T>`, props
  `columns/rows/meta{limit,offset,total}/sortColumn/sortOrder/loading/mobileCards/title/description`,
  emits `page`/`sort`. Wires `UTable` with **server-only** sorting
  (`manualSorting:true`), `UPagination` on offset math, `USkeleton`. Renders a
  full mobile card-list _and_ the desktop table simultaneously, toggled by
  Tailwind breakpoints (two DOM trees, not one adaptive layout). Sophisticated
  stale-while-loading UX (keeps last page's rows dimmed + computes min-height to
  prevent jump). **Gaps**: zero column-type system — every real page (see
  `pages/transactions/index.vue:226-293`) hand-writes badge/link/currency cells
  via per-column slots; no client-side sort/paginate mode; no search
  integration; already carries a `narduk/file-size-budget` eslint-disable (that
  rule is real — `eslint-config/configs/template.mjs:7,58`).
- **narduk-incubator/control-plane** (shallow-cloned to lane scratchpad,
  `2c9b74cf8d8b237699cbbc26c1f058d7fe431a30`): **the brief's premise was wrong —
  no `AppDataTable` exists anywhere in this repo.** Instead, 11 files use
  `<UTable>` directly with zero shared wrapper (fleet/{D1StatementResult 69L,
  D1StudioPanel 602L, TopDimensionCard 32L}, analytics/{Sitemap 145L, GscRows
  53L, ProviderFleetTable 155L, HubIndexnow 191L, GscTopQueries 72L,
  HubGscSitemap 186L}, pages/{index 134L, github 284L, fleet/index 251L}). Only
  **one** of 11 wires `v-model:sorting`; **zero** of 11 use pagination/filter
  row models. `FleetD1StudioPanel.vue:474` passes
  `:columns="gridColumns as any"`. control-plane's table maturity is _below_
  tx-spends' — independent evidence for the same thesis from a third codebase.

## Return-message summary lives in the chat response, not here.
