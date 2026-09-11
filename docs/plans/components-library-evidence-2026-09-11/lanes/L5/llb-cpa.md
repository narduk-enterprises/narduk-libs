# llb-cpa — component-usage survey (L5)

SHA `fec256a5`, branch `main`. Clone ok. Nuxt `^4.4.2`. **No `@nuxt/ui`
dependency at all** (absent from `apps/web/package.json`). Legacy
`narduk-nuxt-template-layer-{core,seo,analytics,testing}@^1.18.43` plus
`narduk-platform@^2.0.0` — `legacy_template_layer: true`. Zero narduk-libs
component adoption (all grep counts 0).

## What this app is

A single-page brochure site for a CPA firm (`package.json` →
`narduk.shortName: "Laura L. Burks, CPA"`,
`narduk.description: "Brochure site for Laura L. Burks, CPA in The Woodlands, Texas."`).
7 `.vue` files total: one page (`apps/web/app/pages/index.vue`, 50 LOC) that
composes six single-use "Brochure*" section components — `BrochureHeader.vue`
(61), `BrochureHero.vue` (60), `BrochureAbout.vue` (69), `BrochureServices.vue`
(42), `BrochureContact.vue` (86), `BrochureFooter.vue` (33) — 401 LOC combined.
No layouts directory, no composables directory.

## Most reusable hand-rolled things

None worth extracting. The only structural repetition is generic
marketing-section shape (header/hero/about/services/contact/footer), each used
exactly once — there is nothing here with more than 1 consumer.

## Table story

No table or list UI exists in this app.
`grep -rlnE '<UTable|<table|role="table"|grid-cols' apps/web/app --include='*.vue'`
hits only `BrochureAbout.vue:12`, `BrochureContact.vue:26`, and
`BrochureServices.vue:25` — all plain 2-column CSS layout grids inside marketing
sections (`grid-cols-2`, or an explicit `grid-cols-[...]` column-width list),
not data grids. A shared table component has nothing to reference here.

`apps/web/server/database/app-schema.ts` is a template placeholder (`export {}`,
comment says "Keep product-owned SQLite tables here") — no tables are actually
defined, and there is no `server/api/` directory at all, so
`BrochureContact.vue`'s form has no visible server wiring in this repo (likely
goes through a shared narduk-nuxt-template-layer-core route not vendored
locally, or is simply unwired — not measured further, out of scope for this
survey).

## What has broken

- **`narduk-enterprises-clients/llb-cpa#48`** (open): "Template-layer exit onto
  narduk-libs (harmony#87 pattern) — web foundation contract §4" — same tracked
  migration ticket pattern seen on circuit-breaker-online (#38).
- No pagination/sort/table/mobile-related issues or PRs (search returned nothing
  beyond #48).
- `apps/web/tests/` exists but was not deep-inspected (no table/pagination
  patterns to check against — out of scope).

Evidence paths: `apps/web/package.json` (no `@nuxt/ui` dependency;
`narduk.shortName`/`description` fields); `apps/web/app/pages/index.vue`;
`apps/web/app/components/brochure/*.vue` (401 LOC combined);
`apps/web/server/database/app-schema.ts`.
