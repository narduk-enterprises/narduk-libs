# pacc-trac — component-usage survey (L4)

SHA `87343b1` on `main`. Single Nuxt 4 + Nuxt UI 4 app at repo root (`app/`,
`server/`), Cloudflare Workers + D1. **Brief correction**: the lane brief
described this repo as a pnpm workspace with
`apps/producer`/`apps/pacc`/`packages/app-shell`; the live repo has none of that
— it's one app with route groups `app/pages/producer/*` and `app/pages/pacc/*`.
The brief's 23-raw-table count and 9-way status-chip claim both verified
correct. Zero narduk-libs adoption: no `@narduk-enterprises/*` dependency at all
(`grep` of package.json and the 13-tag adoption check both came back empty).

## Top reusable things this app hand-rolls

1. **The Ledger table system** — `app/components/Ledger/Table.vue` (86 loc) +
   `usePagedList` composable (`app/composables/usePagedList.ts`, 151 loc) +
   `DenseListPager.vue` (54 loc) + `pagedOffset.ts` (16 loc, unit tested). 14
   app-wide consumers of `usePagedList`, 4 of `LedgerTable` directly (orders,
   customers, tickets, trailers index pages). Server-offset pagination only —
   never slices a client array — 250ms debounced search, yard/tenant scoping via
   `useActing()`, and a clamp-on-mutation edge case already solved and
   code-commented. This is the strongest prior-art candidate in the whole survey
   for narduk-libs' planned shared table: it is already hardened, tested, and
   has real adoption. A shared component should start from this shape, not from
   scratch. Evidence: `app/composables/usePagedList.ts:1-133`,
   `app/utils/ledger.test.ts`, `app/utils/pagedOffset.test.ts`.
2. **Nine separate status-chip components** — `EntityChip` (69 loc, 29
   consumers, dominant), `StageChip` (57 loc, 11), `DocumentExpiryChip` (58 loc,
   8, freshness-flavored — closest match to narduk-ui's `NsFreshnessChip`),
   `LedgerChip` (53 loc, 4), `YardVerifyChip` (79 loc, 3), `PortalStateChip` (16
   loc, 3), `PortalFinalityChip` (18 loc, 2), `SyncStatusChip` (152 loc, 1),
   `PortalPhaseChip` (17 loc, 1). 419 LOC total for what is fundamentally one
   badge component. Evidence: `app/components/Entity/Chip.vue`,
   `app/components/StageChip.vue`, `app/components/Document/ExpiryChip.vue`,
   `app/components/Portal/*Chip.vue`.
3. **`DenseListPager.vue`** (54 loc, 10 consumers) — shared "1–25 of 712,
   filtered by X · Back/Next" footer. Offset-only, no page-number jump, no
   page-size picker.
4. **`LinkedId.vue`** (71 loc, 21 consumers) — the row-link primitive every
   table cell uses to point at another record (`kind`, `label`, `to`).
5. **`shared/utils/format.ts`** (69 loc) — date (`formatDate`,
   `formatDateShort`, `formatDateTime`, `formatMonthYear`, `formatTime`) and
   money/quantity (`money`, `moneyCents`, `pricePerKg`, `kg`) formatters,
   Nuxt-4-auto-imported from `shared/`. Already centralized locally — `kg()`
   alone has 28 call sites. Low-risk candidate to promote as-is into a shared
   formatter.
6. **No shared EmptyState or Skeleton** — `find -iname '*empty*'/'*skeleton*'`
   under `app/` returns zero component hits. Every one of the 23 table files
   writes its own `v-if="!rows.length"` block; loading state is a text string or
   `pending` boolean, never a skeleton.
7. **26 files call Nuxt UI's `UModal` directly** for confirmation; only one
   narrowly-named `Operate/TrailerConfirm.vue` exists as a wrapper. 33 files
   call `useToast()` directly (Nuxt UI's own composable — not a reinvention, but
   narduk-libs ships no toast helper either).
8. **`KpiStrip.vue`** (82 loc) has exactly 1 consumer
   (`app/pages/agent/index.vue`) — likely more KPI-tile rows are hand-rolled
   elsewhere but weren't individually cataloged under this budget.

## The table story

23 files use raw `<table>` markup
(`grep -rln --include='*.vue' -E '<table[ >]' app` = 23, confirmed). Of those,
**6 fetch through `usePagedList`** (server-side offset pagination); the other
**17 render a full client-side array with no pagination, sort, or search at
all** — confirmed by a second, broader pass for `.sort(`/`.slice(`/`.filter(`
inside every one of the 23 files: every hit was either a stat-tally `computed`
or a one-time canonical `.sort()` on mount (`Access/Directory.vue:52`), never a
clickable column-sort. **No table in this app supports interactive column
sorting**, full stop. 4 more pages (`orders`, `customers`, `tickets`, `trailers`
index) consume the shared `LedgerTable` component rather than writing `<table>`
directly — same server-pagination shape.

- **Server vs client paging**: server-offset only where paginated
  (`usePagedList`); several server endpoints (`producer/reconciliation.get.ts`,
  `terms/register.get.ts`, `notifications/email-log.get.ts`) already accept
  `paged/limit/offset` but their pages don't wire a pager UI to it — a shared
  table adopting the same contract would light these up for free.
- **Mobile**: a deliberate, hard-won house style — a global CSS safety net
  (`app/assets/css/main.css:395-421`) turns _any_
  `.overflow-hidden`/`.overflow-x-hidden` wrapper around a `<table>` into a
  horizontal scroller, because a bug on `/trailers` once made the Status column
  and row action unreachable on a 358px phone with no scrollbar (comment names
  it directly). Only one of the 23 tables (`app/pages/producer/config.vue`)
  lacks this — it uses a vertical `overflow-y-auto` box instead, a real gap if
  that list ever grows wide. A shared component must bake in
  horizontal-scroll-by-default the way this CSS rule does, not leave it to each
  consumer.
- **Row links**: `LinkedId.vue` (21 consumers) is the de facto row-link
  primitive already.
- **Column types seen across the 23**: text, badge/status, date, money, number,
  link, actions, image (trailer photo thumbnail on `/trailers`) — a shared table
  needs at least these cell kinds.
- **Server contract**: 20 of the `server/api/**/*.get.ts` routes share one
  zod-validated shape — `limit`/`offset` (max 200), response
  `{ rows, total, limit, offset }`, opt-in via `paged=1` param (default response
  for non-paged callers is a bare array, so it's backward-compatible). Any
  shared narduk-libs table's server contract should match this shape rather than
  invent a new one.

## What has broken (evidence per bullet)

- `pacc-trac#424` (closed issue) — "Invoice print page overflows horizontally at
  390px: bare 1fr grid column, same root cause fixed once already" — a
  mobile-table-adjacent layout bug that recurred.
- `pacc-trac#935` (open issue) — "Orders 'Pick-up' column is always empty" — a
  real column-data gap in the orders `LedgerTable`.
- `pacc-trac#22` (merged PR) — "fix: mobile Safari — viewport discipline,
  console collapse, contained overflow" — an early, broad mobile-overflow fix
  that likely predates the CSS safety net.
- `pacc-trac#774` (merged PR) — "One chip, fed by one label table (P6, #751)" —
  a partial chip consolidation attempt that did not reach all 9 chip components
  (evidence: 9 still exist at HEAD).
- `pacc-trac#340` (merged PR) — "The credit ledger can be taken as a file,
  filtered the way the screen is" — CSV export work on the `pacc/credits.vue`
  ledger table.

Tests touching these patterns: `app/utils/pagedOffset.test.ts`,
`app/utils/ledger.test.ts`, `app/utils/entityChips.test.ts`, plus 4
`test/*.contract.test.ts` files matched by a table/pagination keyword grep but
not individually opened.
