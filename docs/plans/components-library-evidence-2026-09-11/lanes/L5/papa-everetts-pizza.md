# papa-everetts-pizza — component-usage survey (L5)

SHA `2a622c25`, branch `main`. Clone ok. Nuxt `^4.4.2`, Nuxt UI `4.6.0`,
Tailwind `^4.2.1`. Legacy
`narduk-nuxt-template-layer-{core,auth,analytics,seo}@^1.18.26` —
`legacy_template_layer: true`. Zero adoption of any current narduk-libs
component, **including three components narduk-libs already ships by name** (see
below). 24 `.vue` files: 6 components, 16 pages, 0 layouts, 10 composables.
Richest of the three deep-surveyed apps in this lane.

## Most reusable hand-rolled things

1. **`admin/gsc.vue`** (319 LOC, 1 consumer) — duplicates narduk-analytics'
   `AdminGscPerformancePanel`. Contains a genuine native
   `<table class="admin-table">` (line 260) rendering GSC query/page/
   device/country rows with right-aligned `tabular-nums`
   clicks/impressions/CTR/position columns. **This repo has its own local ESLint
   rule for exactly this** — `eslint-plugins/rules/no-native-table.mjs`
   (`atx/no-native-table`: "Disallow native `<table>` — use `<UTable>` from Nuxt
   UI") — and the table bypasses it with
   `<!-- eslint-disable-next-line narduk/no-native-table -- raw HTML table needed for GSC data display with custom styles -->`.
   That comment is the strongest single piece of evidence in this lane that Nuxt
   UI's `UTable` doesn't (or didn't) comfortably support the numeric-column
   styling engineers needed, and had to be escaped.
2. **`admin/posthog.vue`** (768 LOC) and **`admin/analytics.vue`** (148 LOC) —
   duplicate narduk-analytics' `AdminPosthogPanel` and `AdminGaOverviewPanel`
   respectively; posthog.vue is the single largest page file in the app, backed
   by 6 separate `server/api/admin/posthog/*.get.ts` routes (insights,
   recordings, devices, entry-exit, pages, referrers).
3. **`admin/users.vue`** (304 LOC) — duplicates narduk-auth's `AdminUsersTab`.
   Renders users as a plain `<ul>/<li>` list (name, Admin badge, email, "Since
   <date>", reset-password button), with a `useToast()`-driven add-user `UForm`
   and a password-reset `UModal`. The backing route
   `server/api/admin/users/index.get.ts` does
   `db.select(...).from(users).orderBy(desc(users.createdAt)).all()` with **no
   `.limit()` and no page/limit query params anywhere** — every load fetches
   every user.
4. **`admin/index.vue`** (802 LOC) — the menu category/item CRUD editor: one
   card per menu item with inline edit form, Active/Inactive badge, Save/Delete
   buttons, loading text ("Loading menu items..."), empty state ("No items match
   your current selection"). Also unpaginated — `server/api/admin/menu.get.ts`
   orders by category/sortOrder/name with no `.limit()`.
5. **`AdminPriceEditor.vue`** (102 LOC, 1 consumer file, used twice) —
   price-variant key/value sub-editor consumed inside the item cards above.

## Table story

Two real "table" shapes exist here, both worth a shared component covering:

- **Raw HTML table** (`admin/gsc.vue`): server-driven (no client sort/paginate),
  numeric columns needing right-alignment and `tabular-nums`, mobile via
  `overflow-x-auto`, loading spinner + empty state, **no pagination** (GSC API
  returns a fixed row window). A shared table needs a first-class way to do
  tight numeric-column styling or this escape hatch recurs everywhere.
- **Card-list-as-table** (`admin/index.vue`, `admin/users.vue`): CRUD list with
  inline edit/delete/save per row, status badge, loading/empty states, **no
  pagination anywhere in this app** (both backing list endpoints are unbounded
  `SELECT *`-style queries with no `page`/`limit`). Row counts are small today
  (restaurant menu, small user list) but neither endpoint would scale.
- One correct `UTable` usage exists (`admin/guide.vue:449`) but it's a static
  2-column key/value reference table, not a data-driven pattern — not useful
  evidence either way for sort/paginate.

## What has broken

- **`narduk-enterprises-clients/papa-everetts-pizza#75`** (open):
  "Template-layer exit onto narduk-libs (harmony#87 pattern)" — same
  tracked-migration pattern as the other two apps in this lane (#38, #48).
- No table/pagination/mobile-specific issues found in the bounded search; no
  dedicated tests exist for any admin list
  (`grep -rliE 'table|pagination|sort' apps/web/tests --include='*.ts'` → no
  hits).
- Not a filed defect, but worth flagging: `admin/users.vue` and
  `admin/index.vue` both fetch their full list unbounded on every load (no
  `page`/`limit` params, no `.limit()` in the Drizzle query) — a shared table
  component with built-in server pagination would close this gap by construction
  rather than by discipline.

Evidence paths: `apps/web/app/pages/admin/gsc.vue:1,260-289` (table +
eslint-disable); `apps/web/eslint-plugins/rules/no-native-table.mjs`;
`apps/web/app/pages/admin/{posthog,analytics,users,index}.vue`;
`apps/web/app/components/AdminPriceEditor.vue`;
`apps/web/server/api/admin/users/index.get.ts`;
`apps/web/server/api/admin/menu.get.ts`;
`apps/web/app/pages/admin/guide.vue:449`.
