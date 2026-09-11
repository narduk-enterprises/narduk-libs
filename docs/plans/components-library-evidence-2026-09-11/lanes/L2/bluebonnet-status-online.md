# bluebonnet-status-online — component survey (L2)

SHA `638103274d278ad51532400d6e031ba8425ab36b`, branch `main`. Nuxt ^4.4.2 on
the **legacy template layer**
(narduk-nuxt-template-layer-analytics/core/maps/seo/testing/uploads), not
narduk-core/seo/ analytics directly. 36 vue files, 28 components, 7 pages, 14
composables — the richest app in this lane. Adopts `AppMapKit` (3 uses) and
`AppTabs` (2 uses) despite being on the legacy layer.

## Most reusable hand-rolled things

1. **`apps/web/app/components/admin/AdminObservations.vue`** (305 loc, 1
   consumer) — the single richest table example across all four L2 repos.
   `<UTable>` backed by `server/api/admin/observations.get.ts` (zod-validated
   `limit` 1-200/`offset`/`search`/`latMin`/`latMax`/`lngMin`/`lngMax`, response
   `{observations, total, limit, offset}`), hand-rolled Previous/Next paging
   (lines 220-247, no shared pagination component, no URL state), search input,
   row link on `id`, an actions column, and loading/error/empty states. Column
   `id` declares `sortable: true` (line 138) but the `<UTable>` has no
   `v-model:sorting` and the server has a fixed `orderBy` — **the sort flag is
   inert**, a concrete "half-finished pattern" a shared table should either
   fully support or not expose.
2. **`apps/web/app/components/admin/AdminIngestHistory.vue`** (157 loc, 1
   consumer) — a second `<UTable>` (10 columns, `UBadge` status cell) with the
   same inert `sortable: true` flags (lines 15, 18) and no pagination at all —
   `server/api/admin/ingest-history.get.ts` hardcodes `.limit(50)` server-side
   with zero query params.
3. **Auth\* component family** — `AuthLoginCard.vue` (197),
   `AuthRegisterCard.vue` (176), `AuthExchangePanel.vue` (99),
   `AuthLoginFormSection.vue` (81), `AuthRegisterFormSection.vue` (84) — **637
   loc of dead code**. `grep -rn "AuthLoginCard" apps/web/app` (and the same for
   the other four names) returns zero hits anywhere outside their own files;
   there is no `pages/login.vue` or `pages/register.vue` in this app.
   `knip.json` treats `app/components/**/*.vue` as entry points (the standard
   Nuxt auto-import carve-out), so knip's own unused-file check does **not**
   catch this. The names match narduk-auth's shipped
   `AuthLoginCard`/`AuthRegisterCard`/`AuthExchangePanel` exactly.
4. **`apps/web/app/components/app/AppBreadcrumb.vue`** (30 loc, 4 consumers) —
   clean `UBreadcrumb` wrapper that auto-prepends a "Home" crumb; functionally
   the same job as narduk-core's `AppBreadcrumbs`, blocked only by this app
   still being on the legacy layer.
5. **`apps/web/app/components/home/FilterBar.vue`** (68 loc, **0 consumers**)
   and **`apps/web/app/components/sightings/SightingCard.vue`** (57 loc, **0
   consumers**) — two more dead files (125 loc combined); `SightingList.vue`
   appears to have absorbed `SightingCard`'s job inline.
6. **`apps/web/app/components/sightings/SightingList.vue`** (141 loc, 1
   consumer, live) — stage-filter button row + sort `USelect`, the live
   equivalent of the dead `FilterBar.vue`.
7. Two **separate date-formatting utils** —
   `apps/web/app/utils/observationDates.ts` (used by `AdminObservations`) and
   `apps/web/app/utils/dateFormatting.ts` (used by `AdminIngestHistory`) — doing
   overlapping jobs in one app.
8. **`apps/web/app/components/admin/AdminPhotoRotation.vue`** (429 loc) —
   largest file in the app.

## Table story

Two real server-paginated admin tables (`AdminObservations`,
`AdminIngestHistory`), both `<UTable>` (Nuxt UI). What a shared table needs to
cover here: server offset/limit paging with a `{data, total, limit, offset}`
response shape, an optional search param, a working sort affordance (not just a
dead `sortable` flag), row-link cells, a badge cell renderer,
loading/error/empty slots, and a create/edit modal pattern alongside the table.
`mobile` behavior was not measured (no responsive-specific markup found in
either component). Response shapes are inconsistent across this one app's own
endpoints: `{observations,total,limit,offset}` vs `{submissions:[...]}` (no
total) vs a hardcoded-limit array vs `{history:[...]}` — four different shapes
for "return a list," all in the same repo.

## What has broken

`gh pr list --search "table OR pagination OR sort OR mobile"` → **#63 "Stop city
filters sticking on mobile" (merged)**, **#62 "Fix mobile control rage-click
targets" (merged)**, **#61 "Fix rage-click map interactions" (merged)**, **#64
"Fix city map dot rendering" (merged)** — real mobile/filter/map regression
history, unlike the other three L2 repos. `gh issue list` → **#6 "Manual
observation creation uses Date.now() as primary key — silent D1 collision
risk"** (open, touches `AdminObservations`'s create flow) and **#2 "Non-atomic
delete+insert in city content generation..."** (open, backend).
`tests/e2e/visual-audit.spec.ts` and `smoke.spec.ts` reference mobile-related
checks.

## Notes

Best evidence in this lane for both directions of the estate story: (a) a
fully-featured admin table worth generalizing, with one concrete "inert sort
flag" gap to design around, and (b) two pockets of dead code (762 loc total)
invisible to the repo's own knip config that should be flagged to Logan
independent of the table-library project. legacy_template_layer=true but still
consumes two newer-family components (AppMapKit, AppTabs) — the legacy/current
split is not a clean boundary in this repo.
