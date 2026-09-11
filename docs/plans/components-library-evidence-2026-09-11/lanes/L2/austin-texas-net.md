# austin-texas-net — component survey (L2)

SHA `040dbb10b11f5d21d4d3406f06f712e6f027a019`, branch `main`. Nuxt ^4.4.2,
`@nuxt/ui` ^4.3.0 direct dep, on the legacy layer via
`extends: [narduk-nuxt-template-layer-{core,seo,analytics,maps,ingestion}]`.
Largest app in this lane by far: 73 vue files, 24 components, **43 pages**, 4
layouts, 13 composables — a local-info content portal (weather, pollen, bats,
food, real-estate, outdoors, events, culture). Nuxt's directory-prefix
auto-import (`components/map/SpotList.vue` → `<MapSpotList>`) meant consumer
counts had to be re-checked against prefixed tag names, not raw filenames.

## Most reusable hand-rolled things

1. **`apps/web/app/components/app/MapKit.vue`** (915 loc, 11 consumers) — **the
   largest component found in this entire lane**, and a genuine name collision
   worth flagging before anything else: this app has **no dependency on
   `narduk-mapkit-nuxt`** (absent from `package.json`; `nuxt.config.ts`
   `modules` is only `['@nuxt/content','@nuxt/fonts','nitro-cloudflare-dev']`),
   yet its own doc comment reads
   `AppMapKit — Reusable Apple MapKit JS map component`, and Nuxt's
   directory-prefix convention registers this file as the tag `<AppMapKit>` —
   identical to narduk-mapkit-nuxt's shipped component. The app does
   `extends: ['@narduk-enterprises/narduk-nuxt-template-layer-maps', ...]`, and
   a local file at the same relative path as a layer file overrides the layer's
   version — so this could be a full 915-loc independent build, or a local
   override shadowing an equivalent the maps layer already ships. Node modules
   were not installed (clone-only per lane rules), so this could not be resolved
   from this repo alone. **Do not count this as "adopting AppMapKit" without
   resolving which case it is.**
2. **`apps/web/app/components/pollen/Chart.vue`** (241 loc) and
   **`apps/web/app/components/live/ DataChart.vue`** (213 loc, 3 consumers) —
   two near-identical `vue-chartjs` `Line` wrappers (same `chart.js` registrable
   imports, same `ChartArea`/`ScriptableContext`/`TooltipItem` types) inside one
   app. Both duplicate narduk-charts' `NardukLineChart`; the app depends on
   `vue-chartjs` ^5.3.3 directly.
3. **`apps/web/app/components/pollen/StatCard.vue`** (107 loc) — animated
   count-up KPI tile (`requestAnimationFrame`-driven easing), color + suffix
   props. Clean, self-contained, no narduk-libs equivalent exists.
4. **`apps/web/app/components/pollen/SeverityRing.vue`** (127 loc) — gauge/ring
   severity indicator, conceptually close to narduk-ui's
   `NsLevelWell`/`NsRangeBar` band-maths instruments but built independently.
5. **The "spot browser" family** — `map/SpotList.vue` (235 loc, ranked row-link
   list with photo/icon, rating, neighborhood), `map/SpotDetail.vue` (318 loc,
   detail panel), `map/ContentView.vue` (60), `map/ContentPage.vue` (338) —
   reused generically across bat-viewing spots, food spots, and real-estate
   housing-map via a shared `MapSpot` type. **A positive example**: the app
   already generalized this itself rather than copy-pasting per vertical.
6. **`apps/web/app/components/home/Search.vue`** (164 loc, 1 consumer) —
   site-wide client-side search over all categories and live sub-apps, with an
   empty state and focus handling.
7. **`apps/web/app/components/category/Page.vue`** (247 loc, 3 consumers) —
   generic category-page template reused across content verticals.

## Table story

None. `grep -rln --include='*.vue' -E '<UTable|<table|role="table"'` over
`apps/web/app` hits only two files — `pages/real-estate/market-trends.vue`
(line 220) and `pages/real-estate/property-tax-guide.vue` (line 187) — both
confirmed by direct read to be plain static `<table class="w-full text-sm">`
markup inside long-form editorial content, not data-driven UI. No server API
route in this app implements page/limit/sort pagination; the "list-like"
endpoints (`pollen/history`, `live/water-temps/history`,
`live/lake-levels/history`, etc.) are fixed-window time-series feeds, not
paginated collections.

## What has broken

`gh issue list --search "table OR pagination OR sort OR overflow OR mobile OR hydration OR empty"`
→ only an unrelated auth-linking bug (#13) and a closed ESLint-cleanup chore
(#8). `gh pr list --search "table OR pagination OR sort OR mobile"` → all
deploy/template-sync/ESLint-rename chores, nothing UI-behavioral. No regression
history relevant to this survey.

## Notes

The standout findings here are the `AppMapKit` name-collision ambiguity (needs
resolution before feeding into any "N apps already use narduk-mapkit-nuxt"
count) and the in-app duplicate chart wrapper pair. This app is otherwise a
strong example of internal reuse (spot-browser family, CategoryPage) that a
shared component library could still improve on (KPI tiles, chart wrapper)
without needing to touch tables at all — it has none.
