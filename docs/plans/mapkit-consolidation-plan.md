# MapKit consolidation plan — one canonical `narduk-mapkit` in narduk-libs

Status: **draft for Logan's decisions (§12)**, surveyed 2026-09-14 from the
narduk-libs worktree `narduk-mapkit-consolidation-07e309` (base `main`
c1fb48f), company-hq `origin/main` 609aa3e, GitHub code search across
`narduk-enterprises` and `narduk-incubator`, the GitHub Packages registry
(names and versions only), and six read-only inventory lanes whose evidence is
cited inline. Survey claims are hypotheses: every lane that mutates an app
re-verifies the cited file live before acting (AGENTS.md § Native-lane
orchestration).

## 1. Goal

One canonical Apple MapKit JS library, built and published from narduk-libs,
that carries the best implementation of every capability the estate has
written more than once, with every consumer on an immutable published
`@narduk-enterprises/*` release and every earlier iteration retired or recorded
as harvested. "One library" means one workspace home and one release train; it
does not by itself mean one npm package — that is decision D1 in §12.

Done when:

- `packages/modules/narduk-mapkit` and `packages/modules/narduk-mapkit-nuxt`
  are the only MapKit JS sources in any live estate repository (no vendored
  `vendor/narduk-mapkit`, no `file:` tarballs, no git-ref dependencies, no
  app-local copies of the token route, loader, or `AppMapKit`).
- Every consumer pins a published `@narduk-enterprises/narduk-mapkit*` version
  from the same release, and `foundation:check` item 3 stays green on each.
- The standalone `narduk-enterprises/narduk-mapkit` repository is archived with
  a pointer, its two open issues re-homed, and `company-hq#159` closed.
- Each capability absorbed from an app has a test in the library and the
  app-local copy is deleted in the same wave that ships the library release.

## 2. The iterations that exist today

| # | Iteration | Where | Identity / version | Status 2026-09-14 | Evidence |
| --- | --- | --- | --- | --- | --- |
| I1 | First extraction | former `narduk-geo/narduk-mapkit` (org deleted 2026-07-22) | `@loganrenz/narduk-mapkit` 0.3.x, consumed as git refs (`#v1`, a pinned SHA) and an absolute tarball under `~/Library/Application Support/NardukMapKit/` | dead lineage; still referenced by `narduk-earth-data` (archived), `loganrenz/gonogo-web` (retired per D-PORTFOLIO-1), `rawenc-lab` and `grib-viewer` `tools/rawenc-mapkit-viewer` | `narduk-incubator/narduk-earth-data/apps/viewer/package.json:17`, `loganrenz/gonogo-web/package.json:36`, `rawenc-lab/tools/rawenc-mapkit-viewer/package.json:9` |
| I2 | Two-package workspace, old scope | `narduk-enterprises/narduk-mapkit` | `@narduk-geo/narduk-mapkit` 1.0.0–1.6.0 + `-nuxt` 1.0.0–1.6.0 | registry-installable only through **1.1.1**; 1.2.0+ never published because the scope's org was gone (`narduk-mapkit#17`, HTTP 403), so apps vendored tarballs | `farm-analytics/farm-boundary-map/package.json:24-25` (1.2.0 / 1.1.2 tarballs), `loganrenz/wheat-data/web/package.json:16` (1.1.1), `narduk-incubator/status-apps/apps/*/package.json` (1.1.1), `gonogo/src/client/map/vendor/narduk-mapkit/README.md` |
| I3 | Scope rename, standalone | `narduk-enterprises/narduk-mapkit` `main` 9e0ed51 (pushed 2026-08-30, **not archived**) | `@narduk-enterprises/narduk-mapkit` 2.0.0 + `-nuxt` 2.0.0 | strictly behind narduk-libs: whitespace-insensitive diff is 15 core files / 138 insertions (the 2.0.2 `mapkit_js` scope fix, formatting) and 6 Nuxt files (test seams). Open issues #17 (publish, P1) and #18 (layer ordering, P2) live here | `git diff --no-index --ignore-all-space --stat` standalone `src/` vs libs `src/`; `gh issue list -R narduk-enterprises/narduk-mapkit` |
| I4 | **Canonical**: folded into narduk-libs | `packages/modules/narduk-mapkit` 2.0.2, `packages/modules/narduk-mapkit-nuxt` 2.0.5 | published: core 2.0.0, 2.0.1, 2.0.2; nuxt 2.0.0, 2.0.3, 2.0.4, 2.0.5 (nuxt 2.0.1 and 2.0.2 failed to publish — `narduk-libs#152`) | fold landed 2026-09-04 (33805d0, b216772) per D-WEBFOUND-2 Q2 (a); `company-hq#159` (the fold tracker) is still open | `npm view … versions` via `gh-packages-run`; `packages/modules/narduk-mapkit/CHANGELOG.md` 2.0.1 |
| I5 | Nuxt layer origin | `narduk-incubator/narduk-template/layers/maps` and its copies in `narduk-incubator/{control-plane,video-grab}/layers/narduk-nuxt-layer` (synced by `tools/sync-core.ts`) | `AppMapKit.vue`, `useMapKit`, `useMapkitToken`, `mapkitHelpers`, `appleMapToken`, token route, rate limit | harvested into I2 (centralization plan § Consolidated Source Material); template rate limiting, logging, Nuxt UI and color-mode deliberately not retained; incubator repos are off-limits for edits (D-TOOLCHAIN-1) | `packages/modules/narduk-mapkit/docs/centralization-plan.md` |
| I6 | App-local forks (no library, or library plus a parallel copy) | austin-texas-net, float-forecast, hydrogen, earthdata-viewer, gonogo, farm-analytics, harvest-tracker, my-farm (web), incubator passage-map / myboat / boat-search | see §5 | the reconciliation surface of this plan | GitHub code search 2026-09-14; §5 lanes |
| I7 | Library consumers | buoys, lakestat-us, riverstatus, gonogo, mybo-at-v2, pacc-trac-live-hyundai (2.0.2 / 2.0.4); vtraceroute, harvest-tracker, narduk-family-location (2.0.0 / 2.0.0); hydrogen, my-farm (core 2.0.0 only) | registry pins | none is on the current pair (2.0.2 / 2.0.5); three are two patch releases behind on both packages | each repo's `apps/web/package.json` (or root `package.json`) |

Native Swift MapKit code (GeoGridKit, my-farm's Apple targets, ocean-layers-ios,
weather-viewer-mac, RawENCKit) is out of scope, as the centralization plan
already decided: data contracts and tile semantics align, rendering stays in
the Swift packages.

## 3. Governance already decided — not re-litigated here

- **Scope.** `@narduk-geo` is retired; everything publishes under
  `@narduk-enterprises` (company-hq D-FOUND-2 (6), 2026-07-25).
- **Home.** narduk-mapkit (both packages) folds into narduk-libs `modules/`;
  `company-hq#159` is the fold issue; the decommission ledger's "never
  narduk-libs" and narduk-libs#76's "kit repos stay adjacent" are superseded
  (D-WEBFOUND-2 Q2 (a), 2026-09-04).
- **Grid rendering stays out.** Web scalar/grid rendering lives in
  `geogrid-web`; the tile seam (`createMapKitAsyncTileOverlay` taking a plain
  `MapKitTileOverlayImageSource`) is structural, with no dependency in either
  direction (centralization plan D1, 2026-08-28; `geogrid-web/src/tile/image-source.ts:16-19`).
- **Compatibility.** Package changes stay source-compatible for fleet apps
  unless Logan approves a breaking release (narduk-libs `AGENTS.md` § Scope).
- **Library-first.** A MapKit bug found in an app is fixed in the package;
  app-local papering needs a written justification and a removal plan
  (narduk-libs `AGENTS.md` § Library-first fixes).
- **Credentials.** `APPLE_PRIVATE_KEY` is one shared signing persona for every
  consumer — nvault `apple` / `prd` / `mapkit-signing` — delivered as a Worker
  secret; `MAPKIT_SERVER_API_KEY` is evidence-classified dead
  (agent-infrastructure `docs/cloudflare-worker-secrets.md`, D 2026-07-24).
- **Who gets lanes.** `focus: now` rows get agent attention; `next` after
  Cohort 1; `hold` nothing until Logan pulls one up (D-FOCUS-1, 2026-09-07;
  D-FOCUS-4, 2026-09-11). The MapKit consumers by latest focus call:
  - `now`: lakestat-us, riverstatus, buoys, float-forecast, gonogo, hydrogen,
    vtraceroute, Narduk Farm (harvest-tracker, my-farm, farm-analytics),
    earthdata-viewer (`focus_by_repo`), mybo-at-v2, pacc-trac (client plane;
    foundation adoption exempt case by case).
  - `next`: austin-texas-net, bluebonnet-status-online.
  - unranked: narduk-family-location (see §8 for how it is treated).

## 4. Open issues this plan absorbs

| Issue | State today | Disposition in this plan |
| --- | --- | --- |
| `narduk-mapkit#17` publish blocked (P1) | open on the standalone repo | resolved by the fold (2.0.x publishes from narduk-libs); close with a pointer when the repo is archived (§8 W0) |
| `narduk-mapkit#18` `MapKitLayerRegistry` has no overlay ordering (P2) | open on the standalone repo; blocks gonogo deleting its vendored `temporal.ts` | re-file in narduk-libs and fix in the library (§6, §8 W1) |
| `company-hq#159` merge narduk-mapkit into narduk-libs | open, idle | the fold landed 2026-09-04; close when W0 proves archive + pointer |
| `narduk-libs#123` create-narduk-app scaffolds `@narduk-geo` 1.0.0 | open | `manifest.ts:6-7` already pins `@narduk-enterprises` 2.0.2 / 2.0.5; verify the generator tests and close (§8 W0) |
| `narduk-libs#140` remove dual-scope `@narduk-geo` registry constants | open, waits on farm-analytics | closes in the farm-analytics lane (§8 W2) |
| `narduk-libs#138` lint findings deferred by the fold | open | folded into the core hardening slice (§8 W1) |
| `narduk-libs#152` nuxt 2.0.1 failed to publish | open | fixed by 2.0.3 (`prepack` folds `prepare` in, fbc9504); verify and close |
| `narduk-libs#162` release verify step fails after a successful publish | open | release-train bug, not MapKit-specific; W0 checks it does not mask a failed mapkit publish |
| `narduk-libs#124` library hardening tracker (W2) | open | this plan is the MapKit slice of it; link from the tracker |

## 5. Inventory

### 5.0 The canonical library today (lane L-LIB, worktree base c1fb48f)

Core `@narduk-enterprises/narduk-mapkit` 2.0.2 — nine subpaths.

| Subpath | Controllers (stateful) | Plain helpers |
| --- | --- | --- |
| `./client` | `MapKitAnnotationRegistry` (`client/annotations.ts:78`), `MapKitCalloutController` (`callouts.ts:516`), `MapKitFullscreenController` (`fullscreen.ts:239`), `MapKitLayerRegistry` (`layers.ts:311`), `MapKitPointerProbe` (`probe.ts:194`), `createMapKitRenderScheduler` (`render.ts:64`), `MapKitPinScalingController` (`scaling.ts:539`), `MapKitTemporalLayerController` (`temporal.ts:238`), `crossfadeMapKitOverlayOpacity` (`runtime.ts:265`) | script/token boot (`mapkit.ts:106-218`), coordinate/region constructors and tile overlays (`runtime.ts:110-241`), `refreshMapKitMapLayout`, bounds-gated URL templates, timer seams |
| `./server`, `./worker`, `./node` | token handler with origin allowlist, LRU token cache (100 entries, 60 s refresh window — undocumented in either README), `MapKitRateLimitHook` contract (`server/handler.ts:39-41`); `/worker` never touches `process.env`; `/node` adds Doppler CLI fallback | `getOriginFromRequest`, `parseAllowedOrigins`, `isOriginAllowed` |
| `./token` | — | `createMapKitToken` (sets `scope: 'mapkit_js'`, `token/jwt.ts:83`), `createAppleMapsAuthToken`, `decodeJwt`, `isJwtExpired` |
| `./geometry` | — | GeoJSON → drawables, region computation for points / lng-lat bounds / GeoJSON / drawables, hit testing, `gridCluster`, `haversineDistanceMetres`, coordinate normalizers |
| `./playback` | — | route-progress slicing and duration formatting (no MapKit JS dependency) |
| `./apple-maps` | — | developer/access tokens with cache, `searchAppleMaps`, `geocodeAppleMaps`, `searchAppleMapsNeighborhood`, compatibility aliases `getDeveloperToken`, `searchPlaces` |

Nuxt adapter `@narduk-enterprises/narduk-mapkit-nuxt` 2.0.5 — module options
`component`, `composables`, `tokenRoute`, `tokenRoutePath` (`src/module.ts:10-15`);
registers `AppMapKit`, `AppMapKitCallout`, `useMapKit`, `useMapKitCallouts`,
`useMapkitToken`, and the GET token route plus a 405 catch-all. `AppMapKit.vue`
(1314 lines) already carries the contract that austin-texas-net's fork
pioneered: `items`/`createPinElement`, `geojson`/`overlayStyleFn`,
`circles`/`dynamicCircleRadius`, `clusteringIdentifier`/`createClusterElement`,
callout and fullscreen props, `v-model:selected-id`, seven emits, and twelve
exposed methods (`AppMapKit.vue:102-236, 1149-1161`).

Findings that shape §6:

- **The adapter duplicates its own core.** `AppMapKit` wires only the
  fullscreen and callout controllers. It hand-rolls annotation add/remove
  (`AppMapKit.vue:607-665`) instead of `MapKitAnnotationRegistry`, bounding
  regions (`:267-306`) instead of `computeMapKitRegionFor*`, and dynamic circle
  radius (`:804+`) instead of `MapKitPinScalingController`; it never touches
  `MapKitLayerRegistry`, the tile-overlay/crossfade trio, the temporal
  controller, the pointer probe, or the render scheduler. Dark mode is read from
  `document.documentElement.classList` (`:907-912`).
- **Untested surface.** All nine `./playback` functions, `gridCluster`,
  `haversineDistanceMetres`, `isValidCoordinate`, the clamp helpers,
  `searchPlaces`, `exchangeAppleMapsAccessToken`, `getDeveloperToken`, and the
  adapter's `useMapkitToken` have no test references.
- **Unreachable exports.** `token/crypto.ts` helpers are not re-exported by
  `token/index.ts`, so no subpath reaches them.
- **Stale line citations** in `docs/centralization-plan.md:87,89` (code moved
  ~7 lines).
- The module never calls `nuxt.options.build.transpile`; the playground's
  `server/middleware/mapkit-rate-limit.ts` is the only rate-limit provider
  example and ships nowhere.

### 5.1 Engine-class apps: earthdata-viewer, gonogo, farm-analytics (lane L-ENGINE)

All three checkouts were clean and at their own `origin/main` when read
(earthdata-viewer `3f605ba`, gonogo `d73b8ac`, farm-analytics `5ee2334`). The
staleness that matters is dependency staleness against the library, not git.

| App | Core / adapter | How MapKit is wired | Token route | App-owned on top |
|---|---|---|---|---|
| earthdata-viewer | `file:vendor/narduk-mapkit` = **2.0.0, dist only** (no `src/`); no adapter; module not registered (`nuxt.config.ts:15`) | `app/map/mapkitEngine.ts` (582 loc) implements an app `MapEngine` interface (`app/map/mapEngine.ts`) beside a Leaflet fallback (`leafletEngine.ts`, 428 loc), chosen at runtime in `PlaybackView.client.vue:1366` | hand-written `server/api/mapkit-token.get.ts` (23 loc) calling the core's `mapKitTokenResponse`; **dynamic signing is the configured production path** (`wrangler.jsonc` comments) | tile-readiness tracker, dynamic-tile health probe, overzoom/proxy URL logic, a local `now()` clock fix around `crossfadeMapKitOverlayOpacity` (`mapkitEngine.ts:466-493`); 30 test files incl. a 590-loc engine test |
| gonogo | registry **2.0.2 / 2.0.4** (`package.json:64-65`) | Nuxt 4 app with the module registered (`nuxt.config.ts:26,35-37`), but the map is an imperative shell: `src/client/map/engine.ts` (1060 loc) + `page.ts` (1170 loc) import nine `/client` symbols directly; bootstrap goes through a **local** `src/client/mapkit-loader.ts` (65 loc) on MapKit JS **v5** with a single-slot token cache, not `useMapKit` | module route; `src/worker/mapkit.ts` (153 loc) is a **dead** pre-Nuxt Worker signer (own base64url/DER→raw, no `mapkit_js` scope, permissive empty-allowlist default), excluded from Nitro typecheck (`nuxt.config.ts:19`) and alive only through `tsconfig.legacy.json` and tests | domain rendering (`grid.ts`, `rigs.ts`, `view/*`); native clustering through `MapKitAnnotationRegistry` (`engine.ts:728-775`); callouts, fullscreen, pin scaling and the render scheduler all from the library; `src/client/map/vendor/narduk-mapkit/temporal.ts` (231 loc) is the last vendored primitive, held because `MapKitLayerRegistry` only ever calls `map.addTileOverlay()` (append-only, still true at `layers.ts:331,389`) — narduk-mapkit#18; the vendor README still describes a git dependency that no longer exists |
| farm-analytics (`farm-boundary-map/`) | `file:vendor/narduk-geo-narduk-mapkit-1.2.0.tgz` + `-nuxt-1.1.2.tgz` on the **retired `@narduk-geo` scope** (`package.json:24-25`); `-nuxt-1.1.1.tgz` is orphaned in `vendor/` | module registered with `composables: false` (`nuxt.config.ts:53`); `app/composables/useMapKit.ts` (38 loc) replaces the composable to pass `scriptUrl: MAPKIT_JS_V6_SCRIPT_URL` + `loadMapKitLibraries`; `nuxt.config.ts:16-18` aliases the **vendored** `AppMapKit.vue`'s internal `../composables/useMapKit` import onto the app file (coupled to the 1.1.2 compiled layout) | module route + `server/middleware/mapkit-rate-limit.ts` (22 loc) on the documented `event.context.nardukMapKit.rateLimit` hook (180 req / 60 s / origin) — the only correct rate-limit example in the estate | `app/utils/operation-grid-tiles.ts` (227 loc) canvas-baked yield tiles over `createMapKitAsyncTileOverlay` (stays app-side per D1); `installMapKitV6CompatibilityAliases` (`farm-map.ts:64-81`); `<ClientOnly><LazyAppMapKit>` SSR guard; **no live deployment** since Coolify was decommissioned 2026-09-08 (D-COOLIFY-1 / D-RETIRE-1) |

Findings the plan acts on:

- earthdata-viewer's vendored 2.0.0 has the same export surface as today's
  `src` (141/141 names) but its `dist/token/jwt.js:28-43` mints tokens
  **without the `mapkit_js` scope** that 2.0.2 added (`src/token/jwt.ts:83`).
  With dynamic signing as the production path, production tokens come from the
  pre-fix code. See §5.7.
- earthdata-viewer's `wrangler.jsonc` sets `no_bundle: true` +
  `find_additional_modules: true` so the `file:` dependency resolves under
  Nitro's `cloudflare_module` preset; moving to a registry pin changes that
  build contract and must be re-proven with a Worker build, not just edited.
- The crossfade clock mismatch (`performance.now()` frame timestamps against
  the helper's default `Date.now()` clock) is a library bug earthdata-viewer
  fixed locally; a consumer on the default clock gets a crossfade that never
  completes.
- gonogo's loader duplicates `loadMapKitScript`/`initializeMapKit`/
  `fetchMapKitToken` on v5; its vendored `temporal.ts` is, by its own README,
  worse than `createTemporalLayerController` and exists only because of #18.
  The July ledger note that gonogo keeps an app-owned `200` token fallback no
  longer matches the checkout (the module route is registered); re-verify live
  before W2.
- farm-analytics proves two adapter gaps: the composable cannot select MapKit
  JS v6 (`useMapKit.ts:15` passes no `scriptUrl`, so the core default
  `mk/5.x.x` at `client/mapkit.ts:30` applies while `MAPKIT_JS_V6_SCRIPT_URL`
  sits unused one line above), and the component's relative composable import
  is something an app can end up aliasing.

### 5.2 Direct consumers on the 2.0.0 pair: hydrogen, harvest-tracker, my-farm, narduk-family-location (lane L-FARM)

Checkouts clean at `origin/main` (hydrogen `ef6b8c0`, harvest-tracker
`995cc0c`, my-farm `cc6d882`). narduk-family-location (`21f0787`) **has no
`origin` remote in the local checkout**, so its staleness is unknown until it
is read from a wired checkout. All four pin the exact string `2.0.0` (no
caret) and their lockfiles resolve to it (hydrogen `package-lock.json:14`,
harvest-tracker `pnpm-lock.yaml:1123`, my-farm `web/pnpm-lock.yaml:718`,
narduk-family-location `pnpm-lock.yaml:1057`).

| App | Stack | Core / adapter | Token route | Library use | Hand-rolled instead of the library |
|---|---|---|---|---|---|
| hydrogen | Nuxt 4 `web/` + standalone Worker `src/` | 2.0.0 / none; module not registered | Worker `src/router.ts:95-97` via `mapKitTokenResponseFromEnv`; Nuxt only proxies (`web/server/api/[...path].ts`) | `initializeMapKit` from `/client` | `useStationMapKit.ts` (265 loc): annotation lifecycle, clustering, callouts, geolocation + nearest-station; `station-map.ts:125` haversine duplicating `geometry/helpers.ts:220`; Playwright e2e gated by `HYDROGEN_EXPECT_MAPKIT=1` |
| harvest-tracker | Nuxt 4 | 2.0.0 / 2.0.0; module registered (`apps/web/nuxt.config.ts:20`) | module default; no rate-limit hook configured | `<AppMapKit>` + `useMapKit()` in `MapStage.vue` (601 loc) | `map-cell-raster.ts` (413) + `map-geo-image.ts` (241) reinvent projected-image placement instead of `MapKitLayerRegistry`/`createMapKitTileOverlay`/crossfade (zero hits); `map-mapkit-global.ts` (53 loc) typed `mapkit` accessor; replay (`ReplayStage.vue`, canvas) and timelapse (`TimelapseStage.vue`, `<img>`) are not MapKit; **no tests** for map/replay/timelapse |
| my-farm | Vite + React `web/` + Worker | 2.0.0 core only (React — the adapter does not apply) | Worker `web/server/worker.ts:27` via `mapKitTokenResponseFromEnv` | `FarmMap2D.tsx`: `MapKitLayerRegistry` (register/replace/crossfade, `activateWhen: 'first-image'`), `initializeMapKit`, `loadMapKitLibraries`, `computeMapKitRegionForGeoJson` — the strongest core-only citizen, with component + lib tests | hand-rolled `PolygonOverlay` boundaries and a pointermove/click inspector paralleling `probe.ts`; the tile/imagery layer (`mapTiles.ts`, `earthData.ts`, `terrainOverlay.ts`) is shared with a Three.js 3D view that must keep working |
| narduk-family-location | Nuxt 4 | 2.0.0 / 2.0.0; module registered (`apps/web/nuxt.config.ts:16`) | module default; no rate-limit hook; the dev script signs dynamically via `nvault -p apple -e prd -c mapkit-signing` (`package.json:24`) | `LocationMap.vue` (188 loc): items, accuracy circles, GeoJSON breadcrumb, `fullscreen-control` — the cleanest idiomatic `<AppMapKit>` consumer | nothing of note; CSP allows `cdn.apple-mapkit.com` and blocks geolocation (`security-headers.ts:20`) |

### 5.3 Template-layer consumers: austin-texas-net, bluebonnet-status-online, float-forecast (lanes L-ATX, L-FARM)

These three focus apps do **not** depend on narduk-mapkit at all. Each
`extends` the Nuxt layer `@narduk-enterprises/narduk-nuxt-template-layer-maps`,
published from `narduk-enterprises/narduk-template` `layers/maps/` (company-hq
`untangle/inventory/packages.tsv:175`). The layer is a complete, independent
MapKit implementation: its own `AppMapKit.vue` (868 loc), `useMapKit.ts`,
`useMapkitToken.ts`, JWT signing (`server/utils/appleMapToken.ts`, 410 loc,
`jose`), an allowlisted and rate-limited default token route, and an Apple
Maps Server API client (`searchAppleMaps`/`geocodeAppleMaps`). It loads MapKit
JS **v5.x**.

Registry state of the layer (read 2026-09-14 with `gh-packages-run npm view`):
247 published versions, `latest` = 1.19.13 published 2026-05-17, nothing
since. The template repo is not archived (HEAD `a8ce65ee`, 2026-07-25). Its
decommission ledger already amended the maps layer's disposition to "extract
generic behavior into canonical narduk-mapkit … folds into narduk-libs under
company-hq#159" (ledger row 81) and records Austin's Texas-specific wrapper as
staying app-owned (ledger rows 337, 540). Retiring the layer in favour of the
adapter is therefore decided; this plan supplies the how and the when. A sweep
of local checkouts (`package.json` only) found the layer declared by
float-forecast (`^1.18.26`) and the incubator copies of float-forecast and
bluebonnet; austin-texas-net, bluebonnet-status-online and narduk-template
have no `narduk-enterprises` checkout on this machine (lane L-ATX read them
over the GitHub API). The caret ranges resolve to 1.19.13 at most; the three
lockfiles were not read, so the installed layer version is a hypothesis.

| App | Layer pin | Local override | Consumers | Notes |
|---|---|---|---|---|
| austin-texas-net (`040dbb1`, 2026-09-03) | `^1.19.8` (`apps/web/nuxt.config.ts:25`) | **915-loc fork** `apps/web/app/components/app/MapKit.vue` registers as `<AppMapKit>` and shadows the layer's component; own `useMapKit.ts` (v5 loader, dup-load guard, `exp`-based refresh), `useMapkitToken.ts`, and `server/api/mapkit-token.get.ts` that calls the layer's `getMapKitJsToken` but **drops the allowlist and rate limit** the layer's own route has | ~12 pages/sections (`neighborhoods/*`, `live-data/*`, `real-estate/*`, `food/crawfish-season`, `outdoors/bluebonnets`, `ContentView.vue`, `AppShell.vue`) | fork adds Douglas-Peucker simplification + a Texas hole-punch mask (`:186-334`) and count-only cluster bubbles; callouts disabled (`calloutEnabled: false` ×3); never picked up the layer's later `getDisplayPriority`/`suppressSelectionZoom`/`getMap`; no unit tests; `scripts/run-mapkit-e2e.sh` targets a non-existent `apps/showcase`; no `blob:` worker-src CSP override |
| bluebonnet-status-online (`6381032`, 2026-09-02; local copy only under `narduk-incubator/`, stale at `dddbb9c`, 2026-05-18) | `^1.18.26` (`apps/web/nuxt.config.ts:32`) | none — clean layer consumer | 3 pages (`index`, `bluebonnets/[city]/{index,map}`) | uses `getDisplayPriority`, `suppressSelectionZoom`, dynamic circle radius, `createClusterElement`; `cspWorkerSrc: 'blob:'` for MapKit workers; `useBloomMapPins.ts:81-127` puts a real accessibility label on cluster bubbles; `useBloomMapLocation.ts` browser geolocation → "you are here" halo; same dead e2e script; the `narduk-incubator` and `narduk-enterprises` remotes resolve to the same HEAD today — confirm which is canonical before any push; a `staging` Cloudflare environment exists and was not examined |
| float-forecast (`d8c9b2a`) | `^1.18.26` (`apps/web/package.json:58`; layer at `nuxt.config.ts:135`) | own `server/api/mapkit-token.get.ts` (84 loc) calling the layer's `getMapKitJsToken` — like Austin, **no rate limit, no allowlist** | `FloatForecastMapKit.vue` (142 loc) thin wrapper | `float-forecast-mapkit.ts` (348 loc, domain pins/GeoJSON/camera) and `mapkit-tints.ts` (64 loc, pure tint/glyph tables) are the only app-specific pieces; 2 unit tests on token helpers; a `narduk-incubator/float-forecast` clone exists locally, diverged and 5 behind its own origin (off-limits, D-TOOLCHAIN-1) |

That makes **three `AppMapKit` implementations** in production:

| # | Implementation | Size | Has | Lacks | Used by |
|---|---|---|---|---|---|
| 1 | adapter `AppMapKit.vue` (§5.0) | 1314 loc | fullscreen (`:150,156`), callouts (`:129`), clustering (`:135,137`), dynamic circle radius (`:133,147`), `preserveRegion` (`:176`), `suppressSelectionZoom` (`:180`), `getMap` + 11 more exposed methods (`:1149-1162`) | `getDisplayPriority`; a `colorScheme` prop (only internal use at `:501`); any `fallback`/`error` slot | buoys, lakestat-us, riverstatus, mybo-at-v2, pacc-trac-live-hyundai, harvest-tracker, narduk-family-location; gonogo registers the module but bypasses the component; farm-analytics is on its 1.1.2 ancestor |
| 2 | layer `AppMapKit.vue` | 868 loc | clustering, dynamic circle radius, `getDisplayPriority`, `suppressSelectionZoom`, `getMap` | fullscreen, callouts | bluebonnet-status-online, float-forecast |
| 3 | Austin fork of #2 | 915 loc | clustering, dynamic circle radius, Texas mask | fullscreen, callouts (disabled), `getDisplayPriority`, `suppressSelectionZoom`, `getMap` | austin-texas-net |

The adapter already covers everything #2 and #3 offer except
`getDisplayPriority` and the Texas mask, so the layer's retirement is an
adoption exercise plus one prop, not a feature port.

### 5.4 Registry consumers on the current adapter: buoys, lakestat-us, riverstatus, mybo-at-v2, pacc-trac-live-hyundai, vtraceroute (lane L-STATUS)

All six checkouts clean at `origin/main` (buoys `d3e6bff`, lakestat-us
`b46c233`, riverstatus `b8b0201`, mybo-at-v2 `8365c3b`, vtraceroute `7a76b1a`,
pacc-trac-live-hyundai `bc026de`). Five pin **2.0.2 / 2.0.4**; vtraceroute
pins **2.0.0 / 2.0.0**. None overrides a module option (`component`,
`composables`, `tokenRoute`, `tokenRoutePath` all default) and none overrides
the token route, so a consolidated adapter can assume the default names
everywhere. The `pacc-trac-live-hyundai--mapkit` worktree (`lane/mapkit`,
`1d4e0df`) is fully merged into its `main` and its remote branch is gone;
nothing is stranded there.

Only mybo-at-v2 imports the core directly (`apps/web/app/utils/passage-map.ts:1`,
`/geometry`); the other five reach the library only through `<AppMapKit>` and
the three auto-imported composables. That under-use is the root cause of every
duplication below.

| App | Built on top | Duplicates a library capability |
|---|---|---|
| buoys | `StationMapCanvas.vue` (262) + `RegionMiniMap.vue` in `<ClientOnly>`; status-dot pin factory with identity cache (`mapMarkers.ts`); browser + IP geolocation (`useMarineUserLocation.ts`); `localStorage` region persistence | `useMarineMapCalloutOverlay.ts` + `marineMapProjection.ts` (212 loc) re-implement anchored callouts that `AppMapKit` ships as `callouts`/`calloutPlacement`/`calloutMode` + `<AppMapKitCallout>` over `createMapKitCalloutController` (whose JSDoc at `callouts.ts:59-60` gives the exact projection recipe buoys re-derived at `:113-115`); hand-typed `mapkit` global (`:6-12`) |
| lakestat-us | `LakeMapCanvas.vue` (89) with native clustering; `lakestat-map-elements.ts` (95) | pin/cluster scaffolding shape shared with riverstatus (next row) |
| riverstatus | `RiverMapCanvas.vue` (157): pins + `:geojson`/`:overlay-style-fn` river network + `:circles` geolocation pulse; bbox/zoom-bucket GeoJSON loader + cache (`hydro-shape-overlay-loader.ts`, 408) feeding the declarative prop; hover hit-test over GeoJSON (`useHydroShapeFeatureHover.ts`) because MapKit only fires `feature-select` on click | `river-map-elements.ts:29-113` and lakestat-us `lakestat-map-elements.ts:6-72` define the same `*_CENTER`/`*_SPAN`/`*_ANNOTATION_SIZE` constants, `create*MapPinElement(item, isSelected)`, `create*MapClusterElement(cluster, count)` and `*MapkitMutedProps()`; `river-location.ts` (91) is near line-for-line buoys' `useMarineUserLocation.ts` (97); a stale prototype doc (`docs/app-builder/river-shapes/04-mapkit-overlay-prototype.md`) describes the raw-SDK path that was not shipped |
| mybo-at-v2 | `PassageMapKitLayer.client.vue` (146) tracks/vessel/AIS with `preserve-region`/`suppress-selection-zoom`; a **second, independent flat-SVG renderer** (`PassageTrackSvg.vue`, 196) for SSR and for when `useMapKit()` reports `mapkitError`/unconfigured, kept visually in sync by hand | `usePassagePlayback.ts` (144) epoch-ms playback engine that does not use `playback.ts`; region math correctly reuses `computeMapKitRegionForLngLatBounds` |
| vtraceroute | `RouteMap.client.vue` (335) globe (`three-globe`) ⇄ MapKit toggle, multi-phase camera choreography, hop playback; `RoutePulseOverlay.client.vue` canvas pulse | `route-geometry.ts:80-99` region fit with its own antimeridian handling vs `computeMapKitRegionForPoints`/`...ForLngLatBounds` (`geometry.ts:246-313`); coordinate→page projection re-derived (`RoutePulseOverlay.client.vue:28-34`); `types/mapkit.ts` hand-typed global; index-based playback engine not on `playback.ts` |
| pacc-trac-live-hyundai | `LiveMap.vue` (287) simulated fleet; glow + core GeoJSON line styling; typed DOM pin builder (`LiveMapPin.ts`, replaced unsafe `innerHTML` in `88fcc54`); label declutter (`LiveMapDeclutter.ts`) | `app/types/map.ts:34-94` hand-copies `AppMapKit.vue`'s loose GeoJSON/overlay/circle types ("Aligns with AppMapKit 2.0.4"); `nuxt.config.ts:49,57-62` sets a **dead** `runtimeConfig.nardukMapKit` block (the module reads flat `runtimeConfig.appleKeyId` etc., `module.ts:54-58`; `nardukMapKit` is the root-level `configKey`, `module.ts:41`, for `{component, composables, tokenRoute, tokenRoutePath}`); `docs/plan/appendix-c-mapkit.md:33-34` records that `AppMapKit` 2.0.4 has no `colorScheme`, `fallback` or `error` prop, so map-unavailable UX is product-owned |

Adapter facts this lane surfaced, verified in this worktree:

- `AppMapKit.vue:4` is `declare const mapkit: any`, and `:43-91` re-declares
  `GeoJSONGeometry`/`GeoJSONFeature`/`GeoJSONFeatureCollection`/`OverlayStyle`
  locally instead of importing `MapKitGeoJSONFeatureV2`/`MapKitOverlayStyle`
  from the core (`src/types.ts:25,203`, re-exported from the core's root
  export at `src/index.ts:6`). Apps then copy the loose versions a second time.
- The adapter's `package.json` `exports` is `.` only (`types:
  ./dist/types.d.mts`, the module-options type), so the component's prop and
  GeoJSON types have no importable path for consumers.
- The module's token handler already reads both `event.context.cloudflare.env`
  and `process.env` for the bare `APPLE_*`/`MAPKIT_ALLOWED_ORIGINS` names
  (`runtime/server/{runtime-env,mapkit-token.get}.ts`) because Cloudflare
  bindings may not enumerate; no app had to work around Workers bindings.
- The only functional difference between the 2.0.0 pair and today's
  2.0.2 / 2.0.5 is the `mapkit_js` scope fix (core 2.0.2, adapter 2.0.4);
  core 2.0.1 and adapter 2.0.2/2.0.3 are repository and publish fixes, and
  adapter 2.0.5 is tests + README (both CHANGELOGs). Every 2.0.0 consumer bump
  is therefore a pure patch upgrade with no API change. (One lane inferred from
  narduk-libs git history that vtraceroute's 2.0.0 predates `playback.ts`, pin
  scaling and fullscreen; that inference is wrong — the narduk-libs tags start
  at 2.0.1 because 2.0.0 was published from the standalone repo, and those
  modules ship in 2.0.0.)
- buoys' `useMarineMapPersistence.ts:79-97` validates finiteness but not
  lat/lng range (keystone review, low severity). pacc-trac's Apple secrets come
  from the shared `nvault://apple/prd/mapkit-signing` selector (registered
  2026-09-12), the same persona the Cloudflare worker-secrets contract names
  for every app.

### 5.5 Template, incubator and legacy lineage (lane L-LEGACY)

<!-- FILLED WHEN LANE L-LEGACY REPORTS -->

### 5.6 Cross-app duplicate patterns — the feature matrix rolled up

| Pattern | Duplicated in | Library today | Gap that caused the duplicate | Disposition (detail in §6) |
|---|---|---|---|---|
| Script loader / bootstrap / token fetch | gonogo `mapkit-loader.ts` (v5), austin `useMapKit.ts` (v5), layer `useMapKit.ts` (v5), farm-analytics `useMapKit.ts` (v6 override) | `loadMapKitScript`, `initializeMapKit`, `fetchMapKitToken` (`client/mapkit.ts`); adapter `useMapKit` | adapter passes no `scriptUrl`; core default is `mk/5.x.x` while `MAPKIT_JS_V6_SCRIPT_URL` exists | absorb: module option + composable parameter for the script URL; the default version is a §12 decision |
| Token route wrapper that drops allowlist + rate limit | austin, float-forecast (both call the layer's signer from a bare route) | `createMapKitTokenHandler`, `isOriginAllowed`, the rate-limit hook | none — the apps forked the route | delete both routes on adoption; promote farm-analytics' middleware to the documented example |
| JWT signing stack | gonogo `src/worker/mapkit.ts` (dead), layer `appleMapToken.ts`, earthdata vendor 2.0.0 | `token/jwt.ts` with the `mapkit_js` scope | none (pre-fix copies) | delete / bump |
| Region and bounds fitting | austin `computeBoundingRegion`/`track*Bounds` (`:334-392`), hydrogen `regionFor`/`flyToBounds`, vtraceroute `computeRouteRegion`, float-forecast `cameraForSelectedRun`, adapter `AppMapKit.vue:267-306` | `computeMapKitRegionForPoints`/`...ForGeoJson`/`...ForDrawables`/`...ForLngLatBounds` (`geometry/geometry.ts:246-426`); mybo-at-v2 and my-farm reuse them correctly | the adapter itself does not use them (§5.0) | adapter refactor onto the helpers; apps follow when touched |
| Annotation lifecycle + native clustering | hydrogen `useStationMapKit.ts`, austin `pinCleanups` (`MapKit.vue:482-545`), adapter `AppMapKit.vue:607-665` | `MapKitAnnotationRegistry` (`client/annotations.ts:78`); gonogo reuses it correctly | the adapter does not use it (§5.0) | adapter refactor; hydrogen migrates |
| Pin / cluster element scaffolding | riverstatus, lakestat-us, buoys, float-forecast, bluebonnet (`applyClusterAccessibility`), pacc-trac (`LiveMapPin.ts`) | `createPinElement`/`createClusterElement` extension points (documented, correctly used) | no shared marker kit around the extension points; no accessible default for clusters | new adapter helper set (default status-dot pin, count bubble with an accessible label, muted-map preset); bluebonnet's label is the reference |
| Callouts | buoys (212 loc), hydrogen (`annotation.callout`), austin (disabled) | `createMapKitCalloutController`; adapter `callouts` props + `<AppMapKitCallout>` | discoverability only | migrate buoys; document the recipe |
| Coordinate → page projection | buoys `:113-115`, vtraceroute `:28-34` | inside `callouts.ts` JSDoc only | no exported helper | export a projection helper from `/client` |
| Typed `mapkit` global | buoys, vtraceroute, hydrogen `station-map.ts`, harvest-tracker `map-mapkit-global.ts`, adapter (`any`) | none | the adapter declares `mapkit: any`; no exported minimal type | lift harvest-tracker's accessor + a minimal `MapKitGlobal` type into `/client` |
| Adapter prop / GeoJSON types | adapter local interfaces, pacc-trac `types/map.ts` | core `types.ts` (root export) | the adapter re-declares them; no types export path on the adapter | adapter imports the core types; add a types export from the adapter |
| Dynamic circle radius by zoom | austin (`:60-64,585-591`), layer, bluebonnet (consumer) | adapter props `dynamicCircleRadius`/`circleScaleFactor` (`:133,147`) | none — already absorbed | layer/fork consumers get it on adoption |
| Display priority | layer `getDisplayPriority`, bluebonnet (consumer) | absent from the adapter | prop gap | absorb as a prop |
| Geolocation "you are here" | hydrogen `locateMe`, bluebonnet `useBloomMapLocation.ts`, buoys `useMarineUserLocation.ts`, riverstatus `river-location.ts` (buoys/riverstatus near-identical) | none | no primitive | out of narduk-mapkit's scope; recorded for a shared composable elsewhere, not planned here |
| Temporal / playback | gonogo vendored `temporal.ts`, mybo-at-v2 time-cursor engine, vtraceroute index engine, my-farm frame interval | `createTemporalLayerController`, `playback.ts` (index/progress) | #18 append-only registry blocks gonogo; no time-cursor variant | fix #18; diff the two engines against `playback.ts` before extending it |
| Tile overlay / crossfade | earthdata (local clock fix), harvest-tracker (`map-geo-image.ts` reinvents placement), my-farm (correct), farm-analytics (correct) | `MapKitLayerRegistry`, `createMapKitTileOverlay`, `createMapKitAsyncTileOverlay`, `crossfadeMapKitOverlayOpacity` | crossfade clock default; overlay ordering (#18) | fix the clock default + #18; harvest-tracker migrates when touched |
| Theming / colour scheme | austin/layer `useColorMode` watcher, adapter `classList` dark mode (`:907-912`), float-forecast tints, farm-analytics v6 alias shim | none exported | no `colorScheme` prop; v5/v6 enum names differ | adapter `colorScheme` prop; v6 compatibility aliases into `/client` |
| Map-unavailable UX | mybo-at-v2 SVG fallback, pacc-trac product-owned, earthdata Leaflet engine | `useMapKit()` exposes `mapkitError` (`useMapKit.ts:33`) | no `fallback`/`error` slot on `AppMapKit` | adapter slot for the unavailable state; engines stay app-owned |
| GeoJSON polygon simplification + hole mask | austin only | none | Texas-specific | stays app-owned (ledger rows 337, 540) |
| Apple Maps Server API (search/geocode) | layer `appleMapToken.ts` | `/apple-maps` subpath | none — the layer copy retires with the layer | nothing beyond retirement |

### 5.7 Live-risk findings that should not wait for the plan

1. **Tokens minted without the `mapkit_js` scope.** Core 2.0.2 / adapter
   2.0.4 added the scope Apple requires at its JavaScript bootstrap endpoint
   for dynamically signed tokens. Still on pre-fix code: earthdata-viewer
   (vendored 2.0.0 dist; dynamic signing is the configured production path),
   hydrogen, harvest-tracker, my-farm, narduk-family-location and vtraceroute
   (exact 2.0.0 pins). Whether each production deployment signs dynamically or
   serves a static token cannot be read without secret values and was not
   read; narduk-family-location's dev script names dynamic signing. The remedy
   is the same either way: the patch bump, ordered first in W2.
2. **Token routes with no allowlist and no rate limit** in austin-texas-net
   and float-forecast (§5.3). The layer's own route has both; the app
   overrides dropped them. Fixed by adopting the adapter route (W2 for
   float-forecast, W3 for Austin) — or, if a wave slips, by deleting the
   override so the layer's route serves again.
3. **farm-analytics on the retired `@narduk-geo` scope** (narduk-libs#140):
   not live risk (no deployment), but it fails foundation:check item 3 and
   must move scopes, not just versions.

<!-- SECTIONS 6–13 ARE WRITTEN AFTER LANE L-LEGACY REPORTS -->

