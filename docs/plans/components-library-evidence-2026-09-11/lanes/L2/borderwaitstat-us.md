# borderwaitstat-us — component survey (L2)

SHA `0b1da5758c2c1331ee0e5ea39c01c38c07dd2451`, branch `main`. Nuxt 4.4.8 +
narduk-core/seo/analytics/ui (no legacy template layer). 16 vue files total, 11
components, 4 pages, 0 layouts, 6 composables.

## Most reusable hand-rolled things

1. **`apps/web/app/components/border/BorderCrossingDirectory.vue`** (83 loc, 1
   consumer) — groups all crossings by border region into labeled card sections
   with a manual sort-rank map. A shared card-list / grouped-list component
   would need: group-by-key, custom group ordering, group labels.
2. **`apps/web/app/components/border/LocationAwarePortFinder.vue`** (136 loc, 1
   consumer, largest file in the app) — combines a search sheet, lane-mode
   filter, and geolocation-sorted card list. Bespoke to this app (needs
   `navigator.geolocation`); low reuse value as a whole, but its constituent
   parts (search sheet, filter bar) generalize.
3. **`apps/web/app/components/border/LocationAwareSearchSheet.vue`** (116 loc, 1
   consumer) — mobile bottom-sheet search UI. Candidate input for a shared
   `filter_search_bar` / mobile search-sheet pattern if narduk-libs ever ships
   one.
4. **`apps/web/app/components/border/PortDetailPanel.vue`** (122 loc, 1
   consumer) — key/value detail stats grid for a single port, plus a
   **hand-rolled breadcrumb nav** at lines 24-27
   (`<nav aria-label="Border crossing breadcrumbs">` with two static `ULink`s)
   that duplicates narduk-core's already-imported `AppBreadcrumbs`. Cheapest fix
   in this repo: swap 5 lines for `<AppBreadcrumbs>`.
5. **`apps/web/app/components/shared/FreshnessBadge.vue`** (58 loc, 1 consumer)
   — **not** a reimplementation: it is a clean, thin label-vocabulary adapter
   over narduk-ui's `NsFreshnessChip` (maps this app's `fresh/warning/stale`
   onto the design system's `live/aging/stale/void`). Worth holding up as the
   pattern other apps' freshness reimplementations should be compared against.
6. **`apps/web/app/components/border/BorderWaitControls.vue`** (48 loc, **0
   consumers**) — a complete search + lane-mode + border + sort filter bar
   (`UFormField`/`UInput`/`USelect`, `defineModel` bindings) that is dead code:
   `grep -rn "BorderWaitControls" apps/web/app` shows only its own file. Flag
   before using it as evidence of an active pattern.
7. **`apps/web/app/utils/format.ts`** (49 loc) — domain-specific formatters
   (`formatWaitMinutes`, `compactWaitMinutes`, `waitSeverity`,
   `formatFreshness`, `labelLaneCategory`/`labelLaneType`). Not a generic
   date/currency formatter; low reuse value outside wait-time apps.

## Table story

None. `grep -rln --include='*.vue' -E '<UTable|<table|role="table"'` over
`apps/web/app` returns nothing, and no `grid-cols-` list behaves as a table
either. `server/api/border-waits.get.ts` delegates straight to
`readPublicBorderData(event)` and returns the full unpaginated crossing set —
all paging/sorting/ filtering happens client-side over the in-memory array via
`BorderCrossingDirectory`/ `LocationAwarePortFinder`. There is nothing here a
shared `CollectionTable` would replace.

## What has broken

`gh issue list --search "table OR pagination OR sort OR overflow OR mobile OR hydration OR empty"`
→ only issue #13, a CI/deploy credential-provisioning issue, not UI behavior.
`gh pr list --search "table OR pagination OR sort OR mobile"` → PR #24 (wrangler
dependency bump, open), PR #3 (lane-wait retention/batching, merged), PR #1 (SEO
pages, merged) — none concern table/pagination/ sort/mobile UI defects. No
regression history to report for this repo.

## Notes

Smallest of the four L2 repos and the least table-relevant. The two most
interesting findings for the estate-wide plan are (a) the `FreshnessBadge`
adapter as a positive example of narduk-ui adoption, and (b) two pieces of dead
UI code (`BorderWaitControls.vue`, `CrossingCard.vue`) that should not be
counted as "apps hand-roll this a lot" evidence without noting they are
unreferenced.
