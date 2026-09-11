# harvest-tracker — component-usage survey (L7)

SHA `995cc0c` on `main`. apps/web: 93 .vue, 70 components, 18 pages, 3 layouts,
5 composables. Nuxt 4.4.8 + @nuxt/ui 4.6.0, no Tailwind config of its own, no
@tanstack/vue-table. Deps: narduk-core 1.21.0, narduk-auth 1.24.1, narduk-seo
2.0.3, narduk-uploads 1.19.19, narduk-mapkit(-nuxt) 2.0.0. No
narduk-charts/analytics/ai/ui deps.

## Most reusable hand-rolled things

1. **LedgerTable** — `apps/web/app/components/almanac/LedgerTable.vue` (278 LOC,
   3 consumers: MembersPanel, ImportSeasonGrid, FieldRotationCard). Grid-div
   "table": header row, group headers, zebra rows, row-tone emphasis, empty
   slot. No sort/paginate/search/mobile handling at all — it's a static
   presentational shell driven entirely by props.
2. **ReportsYieldLedger** —
   `apps/web/app/components/reports/ReportsYieldLedger.vue` (545 LOC, 1
   consumer). A _second_, raw-`<table>` re-implementation of LedgerTable's
   visual system, because it needs `colspan` expand-row detail bands that
   LedgerTable's grid can't do — the file's own header comment says so
   explicitly (line 5). Strong signal that a shared table needs an
   expandable-row affordance.
3. **ReportsCropCard** — `apps/web/app/components/reports/ReportsCropCard.vue`
   (213 LOC, raw `<table>`, 1 consumer).
4. **AvailabilityChip** / **CropChip** —
   `apps/web/app/components/almanac/{AvailabilityChip,CropChip}.vue` (147 + 81
   LOC, 9 + 5 consumers = 14 total). Two structurally similar status/category
   chips; no shared status-badge component exists in narduk-libs to replace
   either.
5. **StatBlock** — `apps/web/app/components/almanac/StatBlock.vue` (87 LOC, 4
   consumers). KPI tile.
6. **ScreenTopBar** — `apps/web/app/components/shell/ScreenTopBar.vue` (129 LOC,
   **10 consumers** — the single most-reused hand-rolled component in the app).
   Page header/top bar.
7. **almanac-format.ts** — `apps/web/app/utils/almanac-format.ts` (321 LOC, 23
   exported formatters, **48 consuming files** — highest fan-out of anything
   surveyed). Covers dates, currency/price, percent, yield, moisture, timecodes.
   No narduk-libs equivalent exists.
8. **ImportUploader** — `apps/web/app/components/imports/ImportUploader.vue`
   (473 LOC, 1 consumer). Hand-rolled chunked drag/drop uploader hitting
   `server/api/.../imports/[importId]/parts/[partNumber].put.ts`; notable
   because `@narduk-enterprises/narduk-uploads` is already a dependency yet this
   UI isn't built on it.
9. **FarmStateNotice** — `apps/web/app/components/farm/FarmStateNotice.vue` (149
   LOC, 6 consumers). Empty/absent-state card; overlaps narduk-core's
   `AppEmptyState`, which this app never imports (0 usages found).
10. **SectionHeading** — `apps/web/app/components/almanac/SectionHeading.vue`
    (142 LOC, 2 consumers).

## The table story

No true data table (sortable/paginated/searchable) exists anywhere in this app —
all three table-shaped components (LedgerTable, ReportsYieldLedger,
ReportsCropCard) are small, low-row- count, fully client-rendered presentational
shells with **no** pagination, sorting, search, loading/error state, or measured
mobile handling. A shared table for this app's own future needs would mainly
have to cover: (a) grouped rows with a group header + coverage note (from
LedgerTable), (b) an expandable-row-with-colspan-detail-band affordance (from
ReportsYieldLedger, which exists _because_ LedgerTable can't do this), and (c)
numeric/mono column alignment. Two server endpoints already speak a real
offset/limit list contract — `server/api/farms/[farmId]/imports.get.ts` and
`.../artifacts/index.get.ts`, both `{ items, limit, nextOffset, offset }` — but
**no UI currently consumes that pagination** (imports/artifacts render as full
lists), so this repo has list-pagination server plumbing in search of a client
table.

## What's broken

Issue/PR search for table/pagination/sort/mobile/empty/hydration turned up
nothing that is actually a UI-pattern defect: open issues are CI flakiness (#48,
#46) and feature-scope issues (#27, #25, #22), and merged PRs are feature
landings, not fixes to table/pagination/sort behavior. `defect_history` is empty
for this repo — no evidence, not "nothing happened."

## Gaps / not measured

`AppConfirmModal`, `AppTabs`, `AppBreadcrumbs`, toast (`useToast`) usage: all
**0 hits** — this app has no confirm-dialog or toast pattern to survey. Mobile
behavior for the three table components was not measured (no responsive-class
grep run against them). `narduk-family-location` clone failed — repo does not
exist under that name in `narduk-enterprises` or `narduk-incubator` (confirmed
via `gh repo view` + full org listing); skipped per brief.
