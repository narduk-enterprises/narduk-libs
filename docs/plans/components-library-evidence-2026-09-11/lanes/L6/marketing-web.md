# marketing-web — component-usage survey (L6)

SHA `9903e06` on `main`. This is a minimal single-page marketing/portfolio site:
`app/pages/index.vue` is the only page, 5 small presentational components, no
layouts, no composables, no server API. Nuxt 4 + Nuxt UI 4.9,
narduk-core/analytics/seo/app-tools/testkit installed but contribute no visible
templated UI components (narduk-seo/core usage is `useSeoMeta` at
`app/pages/index.vue:129`, not components).

## The table story

None. No `<table>`, `<UTable>`, or `role="table"` anywhere in the app. Not
applicable.

## Other reusable things this app hand-rolls (path / LOC / consumers)

1. `app/components/WorkCard.vue` — 23 loc, 1 usage site (portfolio item card).
2. `app/components/CapabilityCard.vue` — 19 loc, **0 consumers** (tag-grep,
   plain and kebab-case both checked) — appears to be dead/unused code.
3. `app/components/ProcessStep.vue` — 15 loc, 1 usage site.
4. `app/components/FitItem.vue` — 13 loc, 1 usage site.
5. `app/components/BrandLogo.vue` — 34 loc, 1 usage site — brand mark, not a
   lane-target pattern.

All four card-shaped components (WorkCard/CapabilityCard/ProcessStep/FitItem)
are single-page, single-use-site presentational cards — this repo has
essentially no cross-page reuse pressure because it has only one page. None
duplicate a narduk-libs component by name or obvious purpose.

## What has broken

Issue/PR search for table/pagination/sort/overflow/mobile/hydration/empty
returned no UI-behavior defects: the only issue hits were #13 (open, CI gating
for the existing Playwright suite) and #7 (open, missing analytics
instrumentation); PR hits were all Dependabot version bumps (#24, #18, #16). One
e2e spec exists (`tests/e2e/home.spec.ts`), not pattern-specific.

## Counts

vue_files_total 7, components 5, pages 1, layouts 0, composables 0. Commands in
JSON `counts.commands`.

## Bottom line for this lane

marketing-web contributes essentially nothing to the estate-wide
table/pagination/reusable-component case. It is included here for completeness
and to confirm the negative: a well-scoped, single-page marketing site does not
organically grow the patterns this survey is hunting for.
