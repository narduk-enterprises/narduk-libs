# earthdata-viewer — component-usage survey (lane L8)

SHA `3f605bab` (main). App dir: `app/` (single non-monorepo Nuxt app; package
name `@loganrenz/earthdata-viewer`). **Zero narduk-libs dependencies** — no
narduk-core/auth/analytics/seo/ai/ui/charts, no legacy template layer. Uses
`@nuxt/ui ^4.9.0` directly. Vendors `@narduk-enterprises/geogrid-web` and
`@narduk-enterprises/narduk-mapkit` (a different, non-Nuxt package pair) as
local `file:` tarballs — not narduk-mapkit-nuxt's `AppMapKit`.

## Most reusable hand-rolled things (path, LOC, consumers)

1. `app/components/PlaybackView.client.vue` — 2398 LOC, 1 consumer
   (`pages/playback/[layer].vue`). Single-file playback orchestrator
   (catalog/series/grid fetch, temporal cache, stretch state). Too
   domain-specific to extract, but the size alone is a maintainability finding
   worth flagging to the app owner separately.
2. `app/components/viewer/LayerControlPanel.vue` — 497 LOC, 1 consumer. Composes
   Nuxt UI `USelect`/`USlider`/ `UButton`/`UBadge` (lines 136, 174, 194, 205,
   254, 279, 393, 416, 433) into dataset/layer/companion pickers. A shared
   "control-panel section" primitive could shrink this; a table component would
   not touch it.
3. `app/components/viewer/StretchControl.vue` — 321 LOC, 1 consumer. Dual-ended
   value-range control with mode tabs (line 212
   `v-for="option in modeOptions"`). Conceptually near NsLevelWell/NsRangeBar
   but those are read-only band classifiers, not an editable stretch — not a
   strict duplicate.
4. `app/components/viewer/PlaybackTransport.vue` — 291 LOC, 1 consumer.
   Play/pause/scrub bar, no narduk-libs equivalent.
5. `app/components/viewer/RampLegend.vue` — 154 LOC, 1 consumer. Color-ramp
   gradient legend with tick labels over a value range
   (`app/components/viewer/RampLegend.vue:1-50`). Closest narduk-ui sibling is
   NsRangeBar, but that's a freshness/band classifier, not a continuous ramp — a
   design-system look, not a swap.
6. `app/components/viewer/GridInspectPanel.vue` — 83 LOC, 1 consumer.
   Single-value readout on grid click; similar in spirit to NsReadoutTile
   (single value, not tile-styled).
7. `app/components/viewer/MobileControlDrawer.vue` — 64 LOC. Mobile
   bottom-drawer wrapping the desktop panels.
8. `app/components/viewer/DesktopLayerSidebar.vue` — 46 LOC. Thin desktop
   sidebar shell.
9. `app/viewer/formatDate.ts` — dedicated date-formatting util for playback
   timestamps (not measured LOC).
10. `app/viewer/shellLayout.ts` — hand-rolled shell/layout logic; app has no
    narduk-core `LayerAppShell` to lean on.

## Table story

None.
`grep -rlnE '<UTable|<table|role="table"|grid-cols-' app --include='*.vue'`
returned zero hits. This is a map/playback viewer, not a CRUD or list app — the
shared sortable/paginated/searchable table has no consumer here today.
`server/api/` has no `page`/`limit`/`cursor` list contract either
(`server/api/operations.get.ts` is a domain endpoint, not a paginated list).

## What has broken (evidence: `gh issue/pr list --repo narduk-enterprises/earthdata-viewer`)

- PR #104 "Simplify the viewer configurator across desktop and mobile" (merged)
  — control-panel churn.
- PR #57 "spatial console overhaul, multi-dataset stack, mobile dock" (merged) —
  shell/layout churn.
- PR #9 "improve mobile playback controls", PR #25 "Enforce mobile playback
  buffering gate" (both merged) — repeated mobile-transport fixes.
- Issue #95 (open) "Unpublished-product deep link now renders the primary
  product instead of failing closed" — a fail-open error-state bug.
- Issue #130 (open) "wrangler config lacks no_bundle/find_additional_modules;
  production 404 page server-renders empty" — empty-state/deploy-config bug.

## Surprise

This is the one lane-8 repo with **no narduk-libs adoption whatsoever**, not
even narduk-core. It is also not in the `@narduk-enterprises` npm scope. A
shared table component is irrelevant to it until/unless it onboards narduk-core
first — a bigger prerequisite than anything table-shaped.
