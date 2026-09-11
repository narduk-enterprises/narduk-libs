# harmony-hot-sauce — component-usage survey (L4)

SHA `44a8185` on `main`. pnpm workspace (`apps/*`), single app at `apps/web`.
Nuxt 4 + Tailwind 4 on the **legacy**
`@narduk-enterprises/narduk-nuxt-template-layer-{core,seo,auth,analytics,uploads,testing}`
packages (`^1.18.x`) — the broadest legacy-layer set of the three L4 repos (this
one has `auth` and `uploads` too). Real operational app: admin panel (leads,
orders, retailers, SKUs, site content) for a boutique hot-sauce brand, plus a
public storefront built from admin-editable "sections."

## Top reusable things this app hand-rolls

1. **`useHarmonyData` — a single client-fetched data blob.**
   `app/composables/useHarmonyData.ts` (16 loc) does one
   `useFetch('/api/harmony?scope=admin|public')` that returns the _entire_
   dataset (leads, orders, retailers, SKUs, site content); 22 files across the
   app derive their views from this one blob. There is no server-side
   `limit`/`offset`/`cursor` anywhere in `server/api/harmony.get.ts`. This is
   architecturally the opposite of pacc-trac's `usePagedList` — fine at this
   business's current scale, but the piece that would need to change first if
   this app adopted a shared server-paginated table.
2. **Five table surfaces, all via Nuxt UI's `UTable`** — `AdminSkuTableGrid.vue`
   (73 loc), `AdminSiteIssuesTable.vue` (56 loc), `AdminSkuTableImportModal.vue`
   (57 loc, xlsx-import preview), `admin/leads/index.vue` (61 loc),
   `admin/orders/index.vue` (61 loc). Unlike pacc-trac and tprinvest, this app
   already reaches for the "correct" Nuxt UI primitive — but **every one of them
   passes only `:data` and `:columns`**; none use `v-model:sorting`,
   `v-model:pagination`, `v-model:global-filter`, or any `getXRowModel`. Same
   behavioral gap as the other two repos (no interactive sort/paginate/search),
   just starting from a nicer base component.
3. **`AdminStatusBadge.vue`** (35 loc, 5 consumers) — the _only_ status-badge
   component in this repo. Notable contrast with pacc-trac's nine: this repo
   already converged on one, making it a low-risk absorb-as-is candidate for a
   shared chip.
4. **`AdminImageUpload.vue`** (98 loc, 7 consumers, backed by
   `useImageUpload.ts` + `narduk-nuxt-template-layer-uploads`) — the
   most-consumed hand-rolled UI piece in the repo and a real gap: narduk-libs
   ships no file/image upload component today.
5. **`AdminSkuTableImportModal.vue`** (57 loc) — client-side `.xlsx` spreadsheet
   parsing/preview for bulk SKU import, using the `xlsx` package. A pattern
   unique to this repo among the three surveyed.
6. One incidental narduk-core usage: `AdminProductForm.vue:466` uses
   `AppLightbox` directly — the only non-legacy-layer narduk-libs component tag
   found anywhere across all three L4 repos.

## The table story

5 `UTable` surfaces, 0 raw `<table>`. **None are sortable, paginated, or
searchable** — same finding as pacc-trac's 17 non-paginated tables and
tprinvest's total absence, just via a different base component. Rows come either
from a scoped `server/api/admin/*.get.ts` endpoint (SKU grid, site issues) or
straight from the `useHarmonyData()` client blob (leads, orders) — no
`limit`/`offset` contract exists at either layer. **Mobile**: every `UTable` is
wrapped only in a plain `overflow-hidden` div (`AdminSkuTableGrid.vue:34`,
`orders/index.vue:56`, same in leads/index.vue) — no `overflow-x-auto`, no
`min-w-*`, and unlike pacc-trac there is no global CSS safety net here to catch
it. This is an inferred mobile-overflow risk on every admin table, not a proven
bug (no issue found naming it specifically) — flagged for verification, not
asserted as fact. Column types seen: text, badge, date, money, number. A shared
narduk-libs table that wraps `UTable` with sort/paginate/ search and a built-in
mobile-scroll fallback pre-wired would be a drop-in swap here, not a rewrite.

## What has broken / what's tracked

- `harmony-hot-sauce#47` (merged PR) — "Fix mobile product detail overflow" — a
  real, fixed mobile-layout defect (product page, not the admin tables above).
- `harmony-hot-sauce#87` (**open issue**) — "Migrate Harmony onto narduk-libs
  and remove Command control-plane dependency." **This is the original tracker
  that `tprinvest#50` cites verbatim as "the proven downstream migration
  pattern" to follow** — both L4 repos point at the same open estate-wide effort
  (company-hq D-WEBFOUND-2 / company-hq#629 / narduk-libs#76, per tprinvest#50's
  body). Done-when explicitly includes "Replace legacy template-layer/platform
  dependencies with the supported narduk-libs package set."
  Verified-current-as-of note in the issue: 2026-07-24, production healthy,
  deploys app-owned and independent of Command.

No table/pagination/sort/mobile issues matched a broader `gh issue list` search
(repo returned zero hits); no tests reference table/pagination/sort patterns.

## Notes

Two components (`PublicStatsSection.vue`, `AdminSectionEditorStats.vue`) showed
zero consumers under a static `<Tag>` grep, including Nuxt's directory-prefix
auto-import variants. The public site here is built from an admin-editable
"sections" system, so these are more likely resolved dynamically (a section-type
registry / `<component :is>`) than genuinely dead — not confirmed either way
under this lane's budget; worth a closer look if the orchestrator cares about
dead-code alongside reuse.
