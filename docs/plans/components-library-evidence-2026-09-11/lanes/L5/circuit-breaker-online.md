# circuit-breaker-online — component-usage survey (L5)

SHA `d6982c20`, branch `main`. Clone ok. Nuxt `^4.3.1`, Nuxt UI `4.5.0`,
Tailwind `^4.0.0`. Legacy
`narduk-nuxt-template-layer-{core,auth,analytics}@^1.0.16` —
`legacy_template_layer: true`. Zero adoption of any current narduk-libs
component (`AppEmptyState`, `NsFreshnessChip`, etc. all 0 hits). 49 `.vue`
files: 8 components, 36 pages, 3 layouts, 5 composables.

## Most reusable hand-rolled things

1. **Product catalog list/filter/sort/paginate logic** —
   `apps/web/app/pages/products/index.vue` (853 LOC) and its near-duplicate
   `apps/web/app/pages/products/category/[slug].vue` (214 LOC). Server-side
   pagination and sort via `useFetch('/api/products', { query: {...} })`, six
   filter dimensions
   (category/subcategory/manufacturer/voltage/amperage/search), URL state sync
   (`updateUrl()`), mobile filter slide-over, active-filter chip row, loading
   skeleton (`status === 'pending'`), empty state ("No products found"),
   prev/next pager ("Page X of Y"). **No error state at all** — a failed
   `/api/products` fetch has no UI handling
   (`grep -n "status === 'error'" apps/web/app/pages/products/index.vue` → no
   hits). Consumers: 2 pages share this logic by copy-paste, not by extraction.
2. **`ProductCard.vue`** (`apps/web/app/components/ProductCard.vue`, 98 LOC, 2
   consumers) — the row renderer: image, name, manufacturer, SKU, condition
   badge, whole-card `NuxtLink` to `/products/[slug]` (row_link).
3. **`EquipmentPage.vue`** (147 LOC, 8 consumers) and **`IndustryPage.vue`**
   (121 LOC, 4 consumers) — near-identical hand-rolled breadcrumb+hero+content
   marketing page templates, reused across 12 landing pages. Not table-related
   but the single biggest LOC-times-consumers duplication in the app.
4. Legacy auth UI copied into `app/components/`: `AuthLoginCard.vue`,
   `AuthRegisterCard.vue`, `AuthExchangePanel.vue` — these ship from the legacy
   template layer, not narduk-auth.

## Table story

A shared table/grid component for this app must support: **server-side** paging
and sorting (not client-side — the D1-backed API does `LIMIT ? OFFSET ?`, see
`apps/web/server/api/products.get.ts:118-121`), a **card-grid** row layout
rather than literal `<table>` rows
(`grid gap-3 grid-cols-2 lg:gap-4 xl:grid-cols-3`,
`apps/web/app/pages/products/index.vue:792`), whole-row navigation
(`row_link: true`), an image column, a status/condition badge, a multi-dimension
filter bar with a mobile drawer, URL-synced query state, and an explicit error
state (currently missing). Column types needed: image, text, badge, link.

Server contract already exists and is a solid template:
`apps/web/server/api/products.get.ts` — zod-validated query (`category`,
`subcategory`, `manufacturer`, `voltage`, `amperage`, `search`, `page`, `limit`
clamped to `[1,100]`, `sort`), response
`{ products, total, page, limit, totalPages }`.

## What has broken

- **`narduk-enterprises-clients/circuit-breaker-online#22`** (open): "Unguarded
  JSON.parse on product `images`/`tags` columns crashes product API responses."
  Confirmed live in the code read for this survey: the list path in
  `products.get.ts:129` (`images: JSON.parse(String(p.images ?? '[]'))`) has the
  identical unguarded-parse shape as the single-product path the issue names — a
  malformed `images` value would crash the whole catalog list, not just one
  detail page. Directly relevant to what a shared table's data-fetch layer must
  defend against.
- **`narduk-enterprises-clients/circuit-breaker-online#38`** (open):
  "Template-layer exit onto narduk-libs (harmony#87 pattern) — web foundation
  contract §4." Logan already has this app flagged for migration off the legacy
  layer, which is exactly the audit's premise.
- No test coverage exists for the catalog's own behavior: `apps/web/tests/` has
  exactly one file (`sitemap-seo.test.ts`), unrelated to pagination/filter/sort.

Evidence paths: `apps/web/app/pages/products/index.vue` (853 lines, key lines
25-46 types, 80-131 fetch/state, 208 goToPage, 779 loading, 793 ProductCard
loop, 797-816 pager, 825 empty);
`apps/web/app/pages/products/category/[slug].vue` (214 lines);
`apps/web/app/components/ProductCard.vue`;
`apps/web/app/components/EquipmentPage.vue`;
`apps/web/app/components/IndustryPage.vue`;
`apps/web/server/api/products.get.ts`.
