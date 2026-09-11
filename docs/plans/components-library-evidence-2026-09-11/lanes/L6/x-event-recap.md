# x-event-recap — component-usage survey (L6)

SHA `7c60c9b` on `main`. "Mobile-first X event recaps — posted by agents, read
on phone." Tiny Coolify-hosted app (Dockerfile, not Cloudflare Workers like the
other lane repos) — 6 vue files total, 2 pages, 3 components, no tests directory
at all.

## The table story

None. No table anywhere. The closest thing to a data surface is a card/feed list
(see below), and the one list API (`GET /api/recaps`) returns everything
unbounded — no page/limit/cursor/sort params, no enforced limit
(`server/api/recaps/index.get.ts:1-20`, `listRecaps()` called with no bound).
Flagged as a genuine unbounded-list gap, not a UI pattern.

## Other reusable things this app hand-rolls (path / LOC / consumers)

Notably, most of the "patterns" this survey looks for exist here only as
**inline markup inside `app/pages/index.vue`**, not as extracted reusable
components:

1. `app/pages/index.vue` (253 loc total) inlines: a card/feed list of recap
   cards (`TransitionGroup` of `<li>`/`NuxtLink`, live status polling via a
   `watch()` on the fetched list at line 29 — closer to a timeline/feed than a
   static list), inline "live"/"failed" status pills, an inline empty state ("No
   recaps yet"), and inline loading (`USkeleton` x4) and error (`UAlert`)
   states. All of these use Nuxt UI's own primitives directly (`UAlert`,
   `USkeleton`, `UButton`, `UIcon`) rather than a hand-rolled or shared wrapper
   — so there is nothing here with a measurable LOC-saved-by-extraction, but it
   is evidence that this app pattern (agent-posted status feed with
   streaming/failed/done states) recurs.
2. `app/components/RecapRequestForm.vue` — 483 loc, the largest file in the
   repo. Built on Nuxt UI's `UInput`/`UButton`; no shared form-field-set
   component.
3. `app/components/XStreamField.vue` — 187 loc, domain-specific X/Twitter stream
   input, not a lane-target pattern.
4. `app/components/XLogo.vue` — 28 loc, 3 consumers, brand icon.

No `local_reimplementations` flagged — nothing plausibly duplicates a cataloged
narduk-libs component; the app instead uses Nuxt UI natively where it needs
primitives, and inlines everything else directly in the page.

## What has broken

Issue search (table/pagination/sort/overflow/mobile/hydration/empty) returned
nothing UI-relevant: #11 (open, missing analytics instrumentation) and #2
(closed, pre-existing lint debt blocked CI). No matching PRs. No tests directory
exists to check for pattern coverage.

## Counts

vue_files_total 6, components 3, pages 2, layouts 0, composables 1. Commands in
JSON `counts.commands`.

## Bottom line for this lane

Like marketing-web, this repo contributes little direct extraction evidence (no
standalone reusable table/list/state components to point at), but it is a useful
negative/behavioral data point: a small agent-facing status-feed app that (a)
uses Nuxt UI's native primitives correctly instead of reinventing them, and (b)
still leaves its list endpoint fully unbounded.
