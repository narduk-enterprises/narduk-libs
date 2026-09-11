# narduk-nvr — component-usage survey (L7)

SHA `0a9578b` on `main`. Smallest app in L7: apps/web has only 14 .vue files (6
components, 6 pages, 1 layout, 2 composables) -- a household security-camera NVR
frontend, mostly live video and PTZ UI rather than data-heavy screens. Nuxt
4.4.8 + @nuxt/ui 4.6.0. Deps: narduk-core 1.22.0, narduk-auth 1.25.1,
narduk-tenancy 0.2.0. No @tanstack/vue-table, no tailwind.config.

## Most reusable hand-rolled things

1. **MemberManagement / CameraManagement / ShareManagement** —
   `apps/web/app/components/{MemberManagement,CameraManagement,ShareManagement}.vue`
   (142 + 106 + 129 = 377 LOC, 1 consumer each — these are exactly the
   "admin/list pages" the survey brief calls out). All three are plain `v-for`
   over `<div>`/`<section>` with **no table semantics, no sort, no pagination,
   no search**. They are the closest thing to a near-identical repeated pattern
   found in this app: three separate hand builds of "list of entities with
   inline row actions."
2. **RecordingPlayer** — `apps/web/app/components/RecordingPlayer.client.vue`
   (137 LOC, 1 consumer, client-only). Per-day recording filmstrip/timeline
   player.
3. **CameraPlayer** — `apps/web/app/components/CameraPlayer.client.vue` (86 LOC,
   **3 consumers** — the most-reused component in the app, client-only live
   stream player).
4. **PtzControls** — `apps/web/app/components/PtzControls.vue` (112 LOC, 1
   consumer).
5. **history.vue's date+camera filter** — `apps/web/app/pages/history.vue` (116
   LOC). A date picker plus camera-id select drives `/api/recordings/day`;
   simple filter-bar shape.

## The table story

**No table exists anywhere in this app** (`<table>`/`<UTable>`/`role="table"`: 0
hits). The three admin-list components (members, cameras, shares) are the
nearest thing, and none needs much beyond what a shared table's simplest tier
would offer: no sort, no pagination, no search in any of them today. The one
thing worth flagging structurally: `server/api/members/index.get.ts` (evidence
below) runs a fully **unbounded** `db.select()...where(eq(orgId))` with no
`limit`/`page`/`cursor` params at all, unlike mybo-at-v2's
`ORG_LIST_LIMIT`-capped, cursor-paged equivalent for the same "org members +
invites" shape. At this app's expected household-org scale that's low risk
today, but it's the same unbounded-response-bytes shape that mybo-at-v2 issue
#14 (see that repo's report) treats as a defect worth fixing — evidence that a
shared list/table component should default to a bounded contract rather than
leaving each app to discover the limit is missing.

## What's broken

Issue/PR search for table/pagination/sort/mobile/empty/hydration returned only
one open issue (#24, "Release: name the expired tooling token instead of failing
with a git prompt error") — unrelated to UI patterns. No PRs matched.
`defect_history` is empty for this repo.

## Gaps / not measured

`cameras/index.get.ts` and `shares/index.get.ts` response/param shapes were
inferred from their consuming components rather than read directly (recorded as
`"not measured"` for exact params). No tests matched a table/pagination/sort
grep in this repo at all — `tests_covering_patterns` is empty (two unit tests
exist, `media-authorization.test.ts` and `api-authorization.test.ts`, but
neither concerns list/table UI).
