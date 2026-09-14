# nvault — component-usage survey (lane L8)

SHA `117a6a13` (main). App dir: `apps/web` (42 .vue files: 28 components, 11
pages, 2 layouts, app.vue, error.vue). **Zero narduk-libs dependencies**
(confirmed by brief and by `grep '"@narduk-enterprises' package.json` returning
nothing). Fully custom Nitro server (`server/routes/v1`, `server/api/v1/admin`,
layered repositories/services) and fully custom Vue components.
`@nuxt/ui 4.11.0` direct, `tailwindcss 4.3.2` direct.

**This is the richest table evidence in the whole lane.**

## Most reusable hand-rolled things (path, LOC, consumers, what a shared version must cover)

1. `apps/web/app/pages/app/audit/index.vue` — **447 LOC**, 1 consumer. The
   crown-jewel find: a complete hand-rolled **cursor-paginated, multi-filter,
   loading/error-stated** table page. Client hand-rolls its own cursor-history
   stack (`pageCursors` ref array + `pageIndex`, lines 48-49, 161-225) to
   support Previous/Next over a cursor API; `PAGE_SIZE = 25` (line 32); 3
   `USelect` + 6 `UInput` filter fields (lines 269-360), client-validated before
   the request fires; `useApiErrorState(loadError)` classifies
   session/not-found/ forbidden errors (lines 54, 229-232). **No URL
   query-string sync** — filtered/paged state is not shareable or
   back-button-safe (a real gap a shared table should close).
2. `apps/web/app/components/SecretMetadataList.vue` — 162 LOC, 1 consumer. Raw
   `<table>` (desktop, `md:block`)
   - `<ul><UCard>` (mobile, `md:hidden`) dual-render, `UEmpty` empty state (line
     22), formatted timestamps, an actions column (Replace/Delete). Clean
     reference for the desktop-table/mobile-card toggle.
3. `apps/web/app/components/AuditEventList.vue` — 190 LOC, 1 consumer. Same
   dual-render pattern but at the **`lg:` breakpoint** — inconsistent with
   SecretMetadataList's `md:`, a real defect a shared component fixes for free.
   `outcomeColor()` maps success/denied/other → success/warning/error `UBadge`
   color. **No empty-state branch** (gap vs. the other two lists).
4. `apps/web/app/components/TokenMetadataList.vue` — 282 LOC, 1 consumer. Third
   raw-table/mobile-card dual-render, largest of the three.
5. `apps/web/app/components/ConfigList.vue` — 95 LOC, 1 consumer. Card list with
   a client-side `sortedConfigs` computed sort and `UEmpty`.
6. Five domain confirm modals (`RollbackRevisionModal`, `TokenRevokeModal`,
   `ArchiveResourceModal`, `RestoreResourceModal`, `MakeDefaultModal`) — all
   narduk-core's `AppConfirmModal` shape, unused since there's no narduk-core
   dependency.
7. `formattedTimestamp()` — an identical `Intl.DateTimeFormat` helper
   hand-copied into at least `SecretMetadataList.vue` and `AuditEventList.vue`
   (6 lines each) — trivial dedup independent of the table work.

## Table story

Three components share one shape (raw `<table>` desktop / `UCard` list mobile)
at **inconsistent breakpoints** and inconsistent empty-state coverage. The audit
page is the important one: server contract
`apps/web/server/api/v1/admin/audit.get.ts` → `auditPagination()` in
`server/utils/http/validation.ts:340` — an explicit 12-key query allowlist
(`cursor, limit, action, actorId, actorType, configId, environmentId, outcome, projectId, from, to`)
that **rejects any unknown query key outright**, feeding a typed
`AuditPageResponseSchema`. This is the single best server-side list-contract
reference found across the whole lane: cursor pagination (not offset) + rich
filter allowlist + typed response. A shared table needs: cursor-mode pagination
support, a filter-bar slot wired to arbitrary query keys, loading/error state
props, and a desktop-table/mobile-card toggle at one consistent breakpoint prop.

## What has broken (evidence: `gh issue/pr list --repo narduk-enterprises/nvault`)

None found. Both issue and PR searches (limit 40, keywords
table/pagination/sort/overflow/mobile/hydration/ empty) returned only
dependency-bump and CI-infra PRs — no table/pagination/mobile UI defects
recorded yet. This is a young, security-focused app; the audit page's untested
URL-state gap is a latent risk, not (yet) a filed one.

## Surprise

The app with **zero narduk-libs adoption** and **zero recorded UI defects**
produced the single most complete, production-grade example of what the shared
table needs to become (cursor pagination, filter allowlist, loading/error
states) — better evidence than any narduk-libs-adopting app in this lane.
