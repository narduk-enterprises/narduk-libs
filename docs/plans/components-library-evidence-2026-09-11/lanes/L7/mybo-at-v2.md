# mybo-at-v2 — component-usage survey (L7)

SHA `890fd60` on `main`. A genuinely new create-narduk-app scaffold (boat/vessel
tracking): apps/web has only 21 .vue files, 12 components, 7 pages, 1 layout, 2
composables. Nuxt 4.4.8 + @nuxt/ui 4.6.0. Deps: narduk-core 1.21.0, narduk-auth
1.24.0, plus domain packages narduk-devices/logging/realtime/tenancy (0.1-0.2.x)
not seen in other L7 repos. No narduk-mapkit despite a map component existing
(see below). No @tanstack/vue-table.

## Most reusable hand-rolled things

1. **Cursor-pagination contract** — `apps/web/server/orgs/queries.ts`
   (`ORG_LIST_LIMIT = 200`, opaque `createdAt` cursor, `total` repeated on every
   page) backs both `apps/web/app/components/OrgMembersPanel.vue` (453 LOC, 1
   consumer) and `apps/web/app/components/OrgInvitesPanel.vue` (359 LOC, 1
   consumer). This is the **best-designed list-pagination pattern found across
   L7** — see "What's broken" — yet both panels hand-roll their own
   load-more/cursor-tracking logic against the identical response shape
   (`{ members|invites: items, nextCursor, total }`). A shared
   pagination-control component would collapse two independent implementations
   of the same contract.
2. **OrgClaimsPanel** — `apps/web/app/components/OrgClaimsPanel.vue` (301 LOC, 1
   consumer). Device-claim list rendered as `<dl>` label/value pairs
   (`sm:grid-cols-2`), not a table.
3. **PassagePlaybackDeck** — `apps/web/app/components/PassagePlaybackDeck.vue`
   (201 LOC, 1 consumer). Timeline/scrubber for replaying a vessel passage.
4. **PassageMap** — `apps/web/app/components/PassageMap.vue` (181 LOC, 1
   consumer). Notable: `@narduk-enterprises/narduk-mapkit(-nuxt)` is **not** a
   dependency of this app at all (unlike harvest-tracker), so it's not measured
   whether this wraps a shared primitive or is a fully separate map integration
   — worth the orchestrator checking directly.
5. **EdgeStatusBadge** — `apps/web/app/components/EdgeStatusBadge.vue` (52 LOC,
   2 consumers). Small, clean status badge for edge-device connectivity; no
   shared equivalent exists.
6. **VesselStateCards** — `apps/web/app/components/VesselStateCards.vue` (66
   LOC, 1 consumer). KPI/stat-tile row, structurally similar to
   harvest-tracker's `StatBlock`.
7. **PassageRail** — `apps/web/app/components/PassageRail.vue` (101 LOC, 1
   consumer). Horizontal card-list rail.
8. **VesselListCard** — `apps/web/app/components/VesselListCard.vue` (66 LOC, 1
   consumer).

## The table story

There is **no table** anywhere in this app (`<table>`/`<UTable>`/`role="table"`:
0 hits). The three list-shaped panels (members, invites, claims) all render as
`<li>`/`<dl>` lists rather than tabular grids. If a shared table absorbs these,
it needs first-class **cursor** pagination (not just offset/limit — see
`server/orgs/queries.ts`), a `total`-repeated-per-page contract, and per-row
**role-based field redaction** (`OrgInvitesPanel.vue`: invite `email` is nulled
server-side for viewers below `admin`, and the template renders whatever it's
given rather than deciding what to hide) — that redaction-happens-server-side
discipline is a real constraint a shared table would have to preserve, not paper
over.

## What's broken

Issue **#14** (closed) — _"Page the org console's member and invite lists past
ORG_LIST_LIMIT"_: a pre-merge review (PR #12, finding 5) caught that
`.../orgs/[orgSlug]` claimed "the cost is fixed — four statements, whatever the
org's size," which was true of statement count but **not of response bytes** —
an unbounded list would silently truncate at 200 rows with no signal to the
client. PR **#17** (merged) implemented the fix: the `ORG_LIST_LIMIT` cap plus
`createdAt`-cursor pagination now on both `members` and `invites` list
endpoints. This is a real, well-documented instance of exactly the failure mode
a shared, audited list/table component is meant to prevent recurring per-app.

## Tests covering these patterns

`apps/web/tests/unit/org-authority.test.ts`, `.../ui/role-authority.test.ts`,
`.../ui/roles.test.ts`, `.../ui/passages.test.ts`,
`.../e2e/org-journey.spec.ts`.

## Gaps / not measured

Zero explicit narduk-core/narduk-auth component tag usage anywhere in this app —
both are consumed purely through Nuxt layer/module wiring (no local
`login.vue`/`register.vue`; narduk-auth supplies those pages).
`claims/index.get.ts`'s exact param/response shape was not read in detail (same
file family as members/invites, assumed but not confirmed identical).
PassageMap's underlying map library was not identified.
