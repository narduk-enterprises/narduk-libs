# tprinvest — component-usage survey (L4)

SHA `d09c9c3` on `main`. pnpm workspace (`apps/*`, `layers/*`, `packages/*`),
but only `apps/web` exists. Nuxt 4 + Tailwind 4, on the **legacy**
`@narduk-enterprises/narduk-nuxt-template-layer-{core,seo,analytics,testing}`
packages (`^1.18.x`), not narduk-core/auth/analytics. Zero non-legacy
narduk-libs pins.

This is a small historical-archive/reference site for TPR Investments, L.P. (a
Texas firm closed in 2014) — not a data app. No `app/components` or
`app/composables` directory exists at all: just 8 single-file pages (`index`,
`company`, `timeline`, `methodology`, `archived-pages`, `references`, `gallery`,
`brand`) and one layout. No tables, no pagination, no forms of consequence —
findings here are necessarily thin, and this report says so rather than padding
it.

## Top reusable things this app hand-rolls

1. **Page header** —
   `text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100 mb-2`
   is copy-pasted byte-for-byte as the `<h1>` class across 7 of 8 pages
   (`company.vue:57`, `brand.vue:105`, `gallery.vue:46`,
   `archived-pages.vue:56`, `references.vue:71`, `methodology.vue:18`,
   `timeline.vue:136`; `index.vue:40-42` has its own larger
   `text-4xl sm:text-5xl` hero). Trivial one-prop `PageHeader` extraction — this
   is the strongest single finding in this repo.
2. **Header/nav/footer** — `app/layouts/default.vue` (97 loc) hand-rolls the
   whole shell from raw `<header>`/`<nav>`/`<footer>` markup plus three bare
   Nuxt UI primitives (`UNavigationMenu`, `UColorModeButton`, `UIcon`) rather
   than narduk-core's `LayerAppHeader`/`LayerAppFooter`/ `LayerAppShell`. Single
   consumer, but it's the whole site's chrome.
3. **Timeline** — `app/pages/timeline.vue` (306 loc) is the richest interactive
   surface in the app: a year-grouped event feed with per-event
   highlights/evidence sub-lists and a client-side year filter
   (`filteredTimeline` computed, line ~191). Reasonable `timeline_feed`
   extraction candidate if the estate wants one, though this is the only
   consumer found.
4. **Card lists** — `references.vue` (203 loc) and `archived-pages.vue` (217
   loc) render citation/snapshot cards; not read in full (budget), flagged for a
   closer look if timeline/card patterns matter to the shared library.
5. **Gallery** — `app/pages/gallery.vue` uses plain `<img>` tags with no
   click-to-enlarge, modal, or lightbox at all (grepped
   `Modal|dialog|selectedImage|lightbox` = 0 hits). Noted as an absence, not a
   reinvention — narduk-core ships `AppLightbox` already, unused here.

## The table story

None. `grep -rln --include='*.vue' -E '<table[ >]|<UTable' apps/web/app` returns
zero files. No pagination, sort, or search UI exists anywhere in this app.
Nothing to report for "what a shared table must handle" from this repo.

## What has broken / what's tracked

No table/pagination/mobile-overflow issues or PRs exist
(`gh issue list`/`gh pr list` searched for
table/pagination/sort/overflow/mobile/hydration/empty — repo is small and young;
only 2 issues and 3 PRs exist total). The one directly relevant, currently-open
item:

- **`tprinvest#50`** (open issue) — "Template-layer exit onto narduk-libs
  (harmony#87 pattern) — web foundation contract §4." States: _"tprinvest is
  template-layer shaped, with 13–15 `narduk-nuxt-template-layer-*` traces and
  zero current narduk-libs package pins."_ Tracked under `company-hq`
  `DECISIONS.md` D-WEBFOUND-2 (2026-09-04), parent `company-hq#629`, extraction
  tracker `narduk-libs#76`. **It explicitly names
  `narduk-enterprises-clients/harmony-hot-sauce#87` as the pattern to follow** —
  the same migration is tracked for this lane's third repo. This is
  corroborating evidence for an existing estate program, not a new finding, but
  the orchestrator should know both L4 repos point at the same open tracker.

No tests reference table/pagination/sort patterns (none exist to test);
`apps/web/tests/e2e/` holds `visual-audit.spec.ts`, `archive.test.ts`, and
`fixtures.ts`, not individually opened.
