# vtraceroute — component-usage survey (L6)

SHA `7a76b1a` on `main`. Single-page app (`app/pages/index.vue` only) — a live
network traceroute visualizer with globe/map rendering. Nuxt 4.4.8 + Nuxt UI
4.10, and notably: this is the one repo in the lane that already depends on and
uses **narduk-mapkit-nuxt's `AppMapKit`**
(`app/components/RouteMap.client.vue:291`).

## The table story

None. No `<table>`, `<UTable>`, `role="table"`, and no server-side list API —
`server/api/trace.post.ts` is a POST action endpoint (triggers a trace), not a
list GET. Not applicable to this repo.

## Other reusable things this app hand-rolls (path / LOC / consumers)

Every component has exactly 1 consumer because there is only one page — counts
below measure usage sites, not cross-page reuse pressure.

1. `app/components/RouteGlobe.client.vue` — 501 loc, 3D globe rendering (not
   built on AppMapKit — a separate rendering mode).
2. `app/components/RouteMap.client.vue` — 335 loc, wraps narduk-mapkit-nuxt's
   `AppMapKit` directly. **Positive adoption evidence**, not a duplicate to
   extract.
3. `app/components/RoutePulseOverlay.client.vue` — 98 loc, animated pulse
   overlay on the map.
4. `app/components/RoutePlaybackControls.vue` — 74 loc, trace playback scrubber
   — domain-specific, not a lane-target pattern.
5. `app/components/HopTimeline.vue` — 44 loc. A live hop-by-hop feed
   (`aria-live="polite"`), one `<article>` per network hop (index/IP/geo/RTT).
   Has its own inline empty state ("Start a trace to watch routers resolve in
   real time") and its own loading indicator ("Discovering next hop",
   `role="status"`) rather than pulling in any shared component for either
   state.
6. `app/components/RouteFallbackMap.client.vue` — 36 loc, fallback when the
   globe/map can't render.

No `local_reimplementations` flagged: nothing here plausibly duplicates a
cataloged narduk-libs component by name or purpose except the empty/loading
states baked inline into HopTimeline, which are small enough (a few lines each)
not to be worth calling out as standalone reimplementations.

## What has broken

Issue search for table/pagination/sort/overflow/mobile/hydration/empty found one
relevant hit: **#14** (closed) — "wrangler config lacks
`no_bundle`/`find_additional_modules`; production 404 page server-renders
empty." This is the _same class of defect_ independently reported in hydrogen
(#54, closed) — both are a wrangler-bundling gap that breaks the empty/404 page
specifically. Worth flagging to the orchestrator as a possibly-recurring
estate-wide wrangler config gotcha rather than two unrelated one-offs. Only one
open PR: a routine wrangler version bump (#12). No table/mobile UI defects
(expected, since there is no table surface).

## Counts

vue_files_total 8, components 6, pages 1, layouts 0, composables 1. Commands in
JSON `counts.commands`.
