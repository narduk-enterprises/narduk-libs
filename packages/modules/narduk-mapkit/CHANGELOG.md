# Changelog

## 2.10.2

### Patch Changes

- b5932aa: `declutter()` (`./marks`) now sizes its merge grid from the largest
  item radius, so overlapping discs with a radius above 24 px merge wherever
  they sit on screen instead of depending on grid position (#933).
- 9f8e206: `mapOverviewCamera` (`./marks`) frames a point set that straddles the
  antimeridian on its own data. It used a plain min/max of longitudes, so any
  crossing set spanned 360 degrees minus its short arc and always fell back to
  `NORTH_AMERICA_OVERVIEW`. Longitudes are now unwrapped around their largest
  gap before the outlier trim (the rule `computeLongitudeSpan` uses); `span.lng`
  is the short arc and `center.lng` is normalised to -180..180. A set whose
  largest gap already sits across +/-180 is framed exactly as before
  (narduk-libs#932).
- 1ad30f8: `hitTestPolygonOverlays` no longer reports a hit for a point inside a
  polygon's hole. A drawable's `rings` are `[outer, ...holes]` and the overlay
  layer draws the holes empty, so containment is now even-odd across rings; a
  tap on the empty water of a lake no longer selects the surrounding polygon,
  and falls through to a polygon drawn inside the hole (narduk-libs#931).

## 2.10.1

### Patch Changes

- e473c74: `createMapKitFixedWindowRateLimit` no longer keeps a window for every
  client it has ever seen. Expired windows are dropped as time passes, and a new
  `maxKeys` option (default 10,000) caps the live windows; past the cap the
  oldest is dropped and that client starts a fresh window. The per-client
  `cf-connecting-ip` keying in the docs is now bounded under traffic from many
  addresses.
- e473c74: `<AppMapKit>` zoom-to-fit frames points either side of the
  antimeridian the short way round. `mapKitBoundingRegion` now measures
  longitude with the same largest-gap span as `computeCoordinateBounds`, so
  points at 179.5 and -179.5 frame a 1-degree strip centred on 180 instead of a
  359-degree arc centred on 0.

## 2.10.0

### Minor Changes

- a032e64: `rectBeside`, a leader overlay, and `hoveredId` for AppMapKit (design
  round 2, narduk-libs#517).

  `rectBeside(rect, frame, point, anchor, options)` on `./client` is pure camera
  math beside `refreshMapKitMapLayout`: it returns the visible map rect that
  places a coordinate beside a DOM rect, with a gap, a vertical target, and one
  extra zoom step when the station is clustered.

  `MapKitLeaderOverlay` follows an annotation's screen point on every region
  change, draws a line to an anchor element, and reports when the point is off
  screen. `<AppMapKit>` accepts the same overlay as the `leader` prop and emits
  `leader-offscreen`.

  `hoveredId` (`v-model:hovered-id`) sits beside `selectedId`. The matching pin
  host carries `data-mapkit-hovered`; hover never adds or removes annotations.

### Patch Changes

- b6a06b6: Clear the narduk-mapkit lint suppressions left by first-time
  eslint-config adoption (narduk-libs#138).
- 408ad37: README only: point secret-backed local flows at nvault instead of
  Doppler, which is retired except the `ne` root store. `create-narduk-app`
  releases alongside because it pins both packages.

## 2.9.0

### Minor Changes

- ab2a69b: `allowedHosts` (on `MapKitServerConfig`, and the
  `nardukMapKit.allowedHosts` module option) refuses a token for any routed host
  outside the list with `403 not-same-origin`, before the limiter and before
  signing, so a forged `Host` on a Node listener can no longer name the origin
  claim. Unset, nothing changes (#437).
- d671cdc: `<AppMapKit>` moves focus into the callout when a pin is selected
  from the keyboard (narduk-libs#746). Once the `#callout` slot renders, focus
  goes to its first focusable element, so a keyboard or screen-reader user
  reaches the callout's action, such as a "View details" link, without tabbing
  back through the page. A pointer selection leaves focus where it is.
  `calloutFocus="never"` opts out; the default is `'keyboard'`. The pin layer's
  `onSelect` now receives a second argument, `'keyboard' | 'pointer'`, which
  existing handlers can ignore. An app that focuses the callout itself, as
  Buoys' `focusSelectedCalloutAction` does, can delete that code.

## 2.8.2

### Patch Changes

- e61a56d: Docs only (#664). The README and SECURITY.md now say plainly that
  `MAPKIT_ALLOWED_ORIGINS`, `MAPKIT_TOKEN` and `APPLE_MAPKIT_TOKEN` do nothing
  since 2.1 and should not be set. The token route answers same-origin requests
  only, whatever an allowlist holds. SECURITY.md previously told operators to
  set `MAPKIT_ALLOWED_ORIGINS` on production endpoints, which had no effect.
- e61a56d: `<AppMapKit>`'s default error content no longer draws a bare
  browser-chrome button (#614). The title, status code and retry button carry
  `.mk-status-title`, `.mk-status-code` and `.mk-status-retry`. The retry button
  resets its native appearance and reads `--mk-ink`, `--mk-surface`,
  `--mk-font-sans` and `--mk-focus`, with the same neutral fallbacks as the
  marks stylesheet. The `#error` and `#loading` slots are unchanged.

## 2.8.1

### Patch Changes

- 62b7b79: Point `homepage` and `bugs.url` at narduk-libs instead of the
  archived `narduk-enterprises/narduk-mapkit` repo (narduk-libs#540). The
  Changesets fixed group is empty and `narduk-mapkit-nuxt` stays ignored, so
  this patch does not pull the frozen adapter; the adapter's matching metadata
  is updated in tree without a release. `create-narduk-app` is a companion patch
  so the generator-owned mapkit pin moves with it.

## 2.8.0

### Minor Changes

- e82eb47: Export `useMapKitView()` and `useMapKitFullscreen()` from a new
  `@narduk-enterprises/narduk-mapkit/nuxt/composables` subpath.

  Both are public API already: the Nuxt module registers them with `addImports`,
  and `./nuxt` exports their option and result types. Only the functions were
  unreachable by an explicit import -- the exports map has no pattern entry, so
  a caller outside Nuxt's auto-import had no door at all. That bites a unit test
  under plain vitest, an app running with `imports.autoImport` off, and any
  module that wants the function rather than the ambient name.

  `useMapKit()` is deliberately not on the new subpath: it reads the module's
  runtime options through `#imports`, a specifier that resolves only inside a
  Nuxt build, so a subpath carrying it would throw on import anywhere else. The
  two that are exported need Vue and nothing more, because `useMapKitView()`
  takes its MapKit namespace from the `map-ready` payload rather than from the
  kit handle.

  `./nuxt` itself is unchanged: it stays the module entry and must not drag
  Vue's runtime into the graph Nuxt loads modules from.

## 2.7.0

### Minor Changes

- 176cbaf: Decode vector tiles, off the main thread, behind a new
  `./vector-tiles` entry.

  `createMvtDecoder` reads Mapbox Vector Tiles with `@mapbox/vector-tile` and
  `pbf`, and `serveVectorTileDecoder` hosts it in a worker that
  `createWorkerDecoder` (in `./client`) talks to, correlating replies by id and
  transferring buffers both ways so nothing is copied. The protobuf dependencies
  are reachable only from `./vector-tiles`, so a consumer of `./client` never
  bundles a parser; a test walks the import graph and fails if that changes.

  A decoded tile is now columnar -- an `Int16Array` of coordinates plus two
  `Uint32Array` indexes -- rather than an object per point, which is the
  difference between a 256-tile cache retaining about a gigabyte and retaining
  about a hundred megabytes. `buildDecodedVectorTile` packs one,
  `decodedVectorTileBytes` and the new `cacheBytes` measure what is retained,
  and `vectorTileFeatureCount` reads the feature count back.

  Tile bytes are posted as a tight buffer, so a `Uint8Array` that views part of
  a larger allocation decodes correctly and its parent buffer is not detached.
  Requests for an address already in flight join that read instead of starting a
  second one, and `cacheBytes` now counts an estimate of the property payload
  rather than geometry alone.

- 1c64619: Answer a tap on a painted vector tile, and wire the overlay to a Vue
  scope.

  `source.hitTest({ coordinate, zoom, tolerancePx })` returns the nearest
  feature within a screen-pixel radius, with the properties the archive carried.
  It reads only tiles the cache already holds, so it is synchronous and can
  answer inside a gesture; a tap on an undrawn tile misses rather than fetching.
  Distance is measured to the nearest point on a segment, not to a vertex, and
  the probe reaches into neighbouring tiles when it lands within the tolerance
  of an edge -- wrapping at the antimeridian, stopping at the poles -- so a
  river drawn a pixel inside the next tile is still tappable.
  `projectToTilePoint`, `hitTestTile` and `hitTestNeighbours` are exported for
  callers that hold their own tiles.

  `useMapKitVectorTiles()` in the Nuxt module -- which this changeset cannot
  name, because the adapter is frozen at 2.0.x (narduk-libs#405, #421) -- builds
  the PMTiles reader and the overlay source, rebuilds them when the archive url
  changes, repaints a style change from the decoded tiles rather than
  refetching, and terminates the decoder worker with the Vue scope. The worker
  factory and the `pmtiles` reader stay the app's, because a published worker
  chunk is the one thing Vite, webpack and Nuxt do not agree on.

  Two client interfaces were also corrected against the browser types they stand
  in for: `VectorTileCanvasContext.strokeStyle` was too narrow for a real
  `CanvasRenderingContext2D`, and `VectorTileWorkerPort.postMessage` was
  declared so that a real `Worker` could not satisfy it. Both are now proven
  assignable by typecheck-time tests.

## 2.6.0

### Minor Changes

- d077c85: Add a vector-tile canvas overlay source to `./client`.

  `createVectorTileOverlaySource` paints decoded vector tiles to a canvas and
  returns the `imageForTile` function the async tile overlay and the layer
  registry already take, so a dense network stays off MapKit's overlay list.
  Decoded tiles are cached, so `setStyle()` repaints from memory without a
  refetch or a re-decode. The decode step is injected, which keeps this entry
  free of protobuf dependencies and lets an app decode in a worker.

  `createPmTilesTileSource` and `createPmTilesFetchSource` read a PMTiles
  archive over HTTP range requests, taking the reader and the `fetch` they use
  so tests need no network. A missing tile, an empty tile and a failed read all
  resolve to `null` and report through `onError`, instead of throwing into the
  map.

## 2.5.0

### Minor Changes

- 20d72a9: `narduk-mapkit/nuxt` auto-imports `useMapKitView()` and
  `useMapKitFullscreen()`, lifted from buoys. `useMapKitView()` owns the map
  behind a map-first page's `<AppMapKit>` -- camera, frame, zoom tier, padding,
  basemap, the `./marks` layer and fullscreen -- and takes the scoped runtime
  from `map-ready` (K-10). A map-first app no longer copies buoys'
  `utils/mapkit/*` and view composables to draw marks. The `./testing` fake map
  now models `showsMapTypeControl`.

### Patch Changes

- e34b2da: `<AppMapKit>` now infers the app's item type in an SFC template
  (narduk-libs#573, K-1). The exported type keeps only the generic construct
  signature, so `create-pin-element`, `item-key`, `item-label`, `pin-geometry`
  and the `#callout` scope accept callbacks narrowed to the app's own item type
  without a cast. A vue-tsc template fixture in `tests/nuxt/template/` gates it.

## 2.4.0

### Minor Changes

- ef39ebf: Add `@narduk-enterprises/narduk-mapkit/marks`, the point-map mark kit
  lifted from buoys (narduk-libs#517): the declutter engine, label placement,
  keyed mark layer, DOM pin builders, frame and camera math, and IQR overview
  framing. The Nuxt module gains an opt-in `marks` option that adds the marks
  stylesheet (`MAPKIT_MARKS_CSS`) after the host chrome.

## 2.3.1

### Patch Changes

- 92835a1: Lint through `narduk-lint` with a checked-in `lint-budget.json`
  recording the package's current warning counts (narduk-mapkit also marks
  fire-and-forget limiter calls in its tests with `void`). No runtime change;
  the release gate requires a changeset for any changed package file.

## 2.3.0

### Minor Changes

- 36d9e18: The Nuxt module's `/api/mapkit-token` route now applies **no rate
  limit by default** (narduk-libs#485). Since #436 it limited every app to 30
  requests per 60 s per routed origin; that ceiling is now opt-in.
  `ModuleOptions.rateLimit` is optional and has no default: set
  `nardukMapKit: { rateLimit: { limit, windowSeconds } }` to keep a ceiling. A
  limiter an app mounts on `event.context.nardukMapKit.rateLimit` still wins,
  with or without the option. With per-client keying of the default no longer
  needed, narduk-libs#512 is moot.

  Logan's decision (askme, 2026-09-18 14:23 CT): "whatever the least restrcitive
  reasonable option is.....i do NOT want rate limits to come up again....its
  super annoying and not a problem".

  `create-narduk-app` picks up the generator-owned narduk-mapkit pin.

### Patch Changes

- 36d9e18: `./testing` fake: a second `mapkit.init()` while the first token
  exchange is pending, or after it succeeded, is now an idempotent no-op instead
  of throwing `FakeMapKitNotImplemented` (K-7, narduk-libs#522). No new token is
  requested, the first call's options stand, and the call is logged as `init`
  with detail `ignored`. A second `init()` after a failed exchange still runs a
  new exchange, so `retry()` stays testable. New conformance tests pin the rect
  camera (K-5: `visibleMapRect`, `setVisibleMapRectAnimated`, `MapRect` /
  `MapPoint` / `MapSize`, `Map.MapTypes`) against the Web-Mercator maths buoys'
  shim used, in vitest and through `fakeMapKitInitScript()`, so buoys can delete
  both shims.

## 2.2.0

### Minor Changes

- 49d2606: Export §e.4's fixed-window token-route limiter,
  `createMapKitFixedWindowRateLimit`, from the Worker-safe `/server` and
  `/worker` entry points (narduk-libs#485). A Worker caller of
  `mapKitTokenResponseFromEnv` can now pass the same limiter the 2.1 Nuxt module
  applies to its own route, as `{ rateLimit }`. A new optional `key` names the
  bucket: the default is still the routed origin, and a Worker can key per
  client, for example on `cf-connecting-ip`. The Nuxt runtime re-exports the
  same function. `mapKitTokenResponseFromEnv`'s default is unchanged: it applies
  no limiter unless one is passed. Whether it should apply one by default is an
  open decision on #485.

## 2.1.3

### Patch Changes

- cf8e05e: `<AppMapKit>` no longer loads `mapkit.core.js` twice
  (narduk-libs#469). The SSR preload's `useHead()` now runs during the server
  render only. Through 2.1.2 it also ran on the client, where unhead's DOM
  renderer had to recognise the server's `<script>` by hashing every attribute
  on it. Under a nonce CSP (narduk-core `security.headers`) the browser hides
  the tag's nonce as `nonce=""`, the hash never matched, and unhead appended a
  second copy, which MapKit reports as `Mapkit namespace already exists`. On the
  client, Apple's `@apple/mapkit-loader` is now the tag's only owner: it adopts
  the server's tag on an SSR page load and injects the single tag on a
  client-side navigation.

  `@narduk-enterprises/create-narduk-app` only re-releases so its pinned
  `@narduk-enterprises/narduk-mapkit` version follows this patch
  (`scripts/check-generator-release-plan.mjs`'s generator-pin rule). The
  generator's behavior does not change.

## 2.1.2

### Patch Changes

- 62c69e0: Fix a blank map after client-side navigation: a late-mounted
  `<AppMapKit>` never built its `mapkit.Map` because the init watcher fired once
  while `ready` was already true and the canvas ref was still null. Init now
  waits for both MapKit JS and the mounted container, whichever arrives last.

## 2.1.1

### Patch Changes

- 554ae27: Fix the ten kit defects the first adopting app hit on 2.1.0.

  **The one that made maps blank.** MapKit JS 6 resolves
  `mapkit.load(libraries)` to a scoped namespace that is **not**
  `window.mapkit`, and a value built from the global one is refused by your own
  map
  (`Map.addAnnotations expected an annotation at index 0, but got [object EventTarget]`).
  The fake collapsed the two into one object, so a suite could be green against
  it and blank against Apple. The fake now models the split; `<AppMapKit>` hands
  the right namespace over as `map-ready`'s **second argument** and as a new
  exposed `getMapKit()` (both additive — no existing handler or ref breaks).

  **The rest.** `<AppMapKit>`'s generic now reaches `createPinElement`,
  `itemKey`, `itemLabel`, `pinGeometry` and the `#callout` slot, so an adopting
  component no longer needs a cast at the call site. `mapType` and `colorScheme`
  are written to a live map when the prop changes, not only in the constructor,
  and `mapType` accepts Apple's `'mutedStandard'` beside this library's
  `'muted'`. The component ships the host chrome as a module-injected stylesheet
  (single-class selectors, first in `nuxt.options.css`, layout only) instead of
  making every app rewrite it. A new `pinsFocusable={false}` makes pins
  decorative for a map whose pins are not the interactive surface. A missing
  `itemLabel` now throws from `setup` instead of during the first map init. And
  the fake models the rect camera (`visibleMapRect`,
  `setVisibleMapRectAnimated`, `padding`) and records degenerate inputs on
  `inspect.degenerateCameraInputs`.

  **Operators:** no configuration changes, no route changes, no new environment
  names. Apps on 2.1.0 upgrade in place. The one visible change is the
  stylesheet: if your app already ships the `.mapkit-wrapper` / `.mapkit-canvas`
  / `.mapkit-status` rules by hand, they still win (they load after ours and
  ours are single-class with no `!important`), and you can delete them.

## 2.1.0

### Minor Changes

- 840e069: Ship `<AppMapKit>` and `useMapKit()` from a new
  `@narduk-enterprises/narduk-mapkit/nuxt` entry — a Nuxt 4 module that
  registers the component, the composable, and the same-host token route
  (narduk-libs#422 §b, §c, §e).

  **`itemKey` makes an `items` change a diff, not a rebuild.** This is the
  buoys#112 root cause: without a stable key per item the pin layer had no way
  to tell "the same 570 stations, three of them moved" from "570 different
  stations", so every update tore the annotations off the map and rebuilt them —
  losing selection, losing the open callout, and re-running every pin's element
  factory. `itemKey` defaults to the item's `id` and the layer reports `added`,
  `moved`, `removed`, and `restyled` through `getDiagnostics()`, which is what
  the regression test asserts against (570 removes + 570 adds for the 2.0.x
  shape, zero of either for a keyed move).

  **`pinGeometry` is per pin.** 2.0.x had one global `annotationSize`, so an app
  with two pin shapes could anchor only one of them correctly (narduk-libs#305).
  `pinGeometry(item)` returns `{ anchor, anchorOffset, size }`; `anchor`
  defaults to `'bottom-center'`. MapKit's `anchorOffset` positions the element's
  _top-left_ at the projected point, so the library derives the offset from the
  size rather than leaving each app to rediscover that.

  **`#callout` is a scoped slot rendered through a `Teleport`.** MapKit's own
  callout can only contain DOM handed to it as an element, which is why a
  `NuxtLink` inside one never routes. The slot receives
  `{ close, id, item, placement, position }` and renders into a host the library
  positions and re-projects on every region change; a host it cannot project is
  hidden rather than stranded at a stale position.

  **`libraries` is configurable and required.** The module's default is the
  `['map', 'annotations', 'overlays']` triple 2.0.x hard-coded, but an app can
  now narrow or widen it. It is resolved in `setup` rather than declared in the
  module's `defaults`, because `defineNuxtModule` merges those with `defu`,
  which concatenates arrays — a default there would make the option impossible
  to narrow. An empty list throws at module setup instead of failing later at
  `new mapkit.Map(...)`.

  **`retry()` is on the exposed API**, and `#error` receives
  `{ failure, retry }`. A MapKit failure clears the cached initialization, so
  recovery has to be the caller's call.

  Three defaults flip, each measured across the existing consumers:
  `preserveRegion` (7 of 7 set it) and `suppressSelectionZoom` (4 of 5 selection
  users set it) are now `true`, and `showsPointsOfInterest` (6 observed values,
  all `false`) is now `false`.

  SSR emits `renderHTMLAttributes()` through `useHead` from the _component_, not
  from the module into the app head, so a page that renders no map makes no
  request to `cdn.apple-mapkit.com`. It carries no token: a token in the tag is
  MapKit's static, non-refreshable path.

  The token route the module registers resolves its `self` through
  `mapKitRoutedOrigin`, so an absolute-form request line cannot name the origin
  claim, and `tokenRoutePath` now refuses a `//`-prefixed path at module setup —
  it starts with `/` but is protocol-relative, so `fetchMapKitToken` would
  otherwise only throw at first paint from inside the loader.

  Otherwise it is the same fail-closed handler `/server` exports, plus a
  fixed-window ceiling (`rateLimit: { limit: 30, windowSeconds: 60 }`) applied
  per routed origin. An app that mounts narduk-core's own limiter on
  `event.context.nardukMapKit.rateLimit` still wins; the default only means an
  unconfigured JWT-signing route is not an unlimited one. The 2.0.x adapter's
  zero-consumer surface is deliberately not carried over.

  `@nuxt/schema` becomes an optional peer dependency: `dist/nuxt/index.d.ts`
  names `NuxtModule`, which `@nuxt/kit` does not re-export.

  Review round (Grok adversarial) on PR 436:

  - `tokenRoutePath` and `fetchMapKitToken` now canonicalise `\` to `/` before
    the protocol-relative check. WHATWG treats `/\evil.example/mk` as
    `//evil.example/mk`, so a startsWith('//') check let a backslash path leave
    the serving origin.
  - The method catch-all is a re-export of the GET handler. A dummy with empty
    credentials 503'd any GET that landed on it.
  - `<AppMapKit>` passes `isRotationEnabled` into the Map constructor. MapKit JS
    defaults rotation on; omitting the flag ignored the documented `false`.
  - The pin layer reads `pinGeometry` / `itemKey` from the live props, so a
    geometry-only `setProps` restyles in place instead of keeping the init-time
    anchor.

  Review round 2 (Opus finish pass) on PR 436:

  - The same canonicalisation now strips ASCII tab, LF and CR first. WHATWG
    removes those from the input BEFORE parsing, so `/<TAB>/evil.example/mk` and
    `/<TAB>\evil.example/mk` were still protocol-relative and the `\`-only fix
    did not see them.

- 310121b: Add `@narduk-enterprises/narduk-mapkit/testing`: a deterministic,
  offline fake of MapKit JS v6 for component and end-to-end tests.

  The fake is modelled on a measured spike against real MapKit JS 6.0.128 rather
  than on the documentation alone. It covers `load()` with library gating,
  `init()` with the `configuration-change` and `error` events (Apple's seven
  `ConfigurationErrorStatus` values verbatim), scriptable authorization outcomes
  including the measured origin-mismatch shape (the same token retried three
  times, `authorizationCallback` invoked exactly once, then `Unauthorized`), an
  injected access-key clock, `mapkit.Map`, the three annotation classes, and the
  value types. Anything it does not model throws
  `FakeMapKitNotImplemented: <member>` instead of silently answering
  `undefined`.

  A separate inspection surface records an operation log with per-annotation
  add/remove counts, so a component test can assert a reconciliation budget --
  "updating 1 of 600 pins touched 1 annotation, not 600" -- rather than only a
  final-state outcome. `fakeMapKitInitScript()` serialises the whole fake for
  Playwright's `page.addInitScript`; it is one self-contained function, so there
  is no bundler step and no second implementation.

  `./testing` is a dev-time export: it carries no runtime dependency, and an
  import-graph test asserts no production entry point can reach it. The fake's
  public types are declared structurally, so the published `.d.ts` resolves
  without Apple's types installed, while a type-level conformance suite compares
  it member by member against `@types/apple-mapkit` v6 and fails typecheck on
  drift.

  `@narduk-enterprises/create-narduk-app` gets a patch release so it can refresh
  its pinned `narduk-mapkit` version in `src/manifest.ts`
  (`scripts/check-generator-release-plan.mjs` requires a generator release
  whenever a package it pins changes version). No generator behavior changes.

- bd4e8ea: Load MapKit JS through Apple's own `@apple/mapkit-loader`, type the
  client against Apple's v6 types, and make the token route same-host and
  fail-closed (narduk-libs#421 §d, §e).

  **The token never goes to `load()`.** 2.0.x passed the JWT as
  `load({ token })`, which lands in `data-token` on the injected script and
  wires MapKit's static, non-refreshable path: the map dies when that token
  expires and nothing re-asks. 2.1.0 calls `load()` with no token at all and
  delivers it only through `mapkit.init({ authorizationCallback })`, which is
  the path MapKit refreshes on its own (measured: an accessKey good for ~1800 s,
  renewed without a second `authorizationCallback` call).

  **`libraries` is required.** MapKit JS 6 loads `mapkit.core.js`, a stub with
  no map, annotations, or overlays until libraries are named. Making it optional
  would only move the failure to the first `new mapkit.Map(...)`, so
  `initializeMapKit()` refuses an empty list up front. `loadMapKitLibraries()`,
  `MAPKIT_JS_V6_SCRIPT_URL`, and the `scriptUrl` option are gone from the option
  surface: Apple's loader owns the script URL and throws on any `5*` version.

  **A failure clears the singleton.** Measured against real MapKit on
  2026-09-17: on a rejected token it retried `/ma/bootstrap` three times with
  the _same_ token, invoked `authorizationCallback` exactly once, and gave up.
  So the `error` listener clears the cached initialization on every error —
  including one that arrives long after init resolved — and recovery belongs to
  the caller's `retry()`. The authorization callback never answers `done('')` on
  a failed fetch; an empty token is just a second bootstrap attempt that fails
  with a less useful status than the real cause. `MapKitErrorStatus` is Apple's
  `ConfigurationErrorStatus` verbatim, pinned to
  `MapKitConfigurationErrorEvent['status']` by a compile-time conformance check
  rather than restated by hand and left to drift.

  **The token route mints for the origin that routed the request, and nothing
  else.** `self` comes from the routed request URL — never `Origin`, `Referer`,
  or an `X-Forwarded-*` header, any of which a caller controls. A missing
  `Origin` is legitimate (a same-origin `GET` from `fetch` sends none), so
  `Sec-Fetch-Site` carries the signal and the route fails closed when neither is
  conclusive. The `origin` claim is built from `URL.origin`, so it carries
  scheme, host, and a non-default port exactly as Apple compares them.
  `allowedOrigins` and the static `MAPKIT_TOKEN`/`APPLE_MAPKIT_TOKEN` path are
  accepted and ignored, reported as deprecated through the log hook: an
  allowlist cannot make a token work on a host Apple itself will reject, and a
  portal token that works everywhere is one with no origin restriction at all.

  The default JWT TTL drops from 24 hours to 1800 seconds. `exp` bounds the
  _minting_ window, not the session — MapKit spends the JWT once at bootstrap
  and runs on the accessKey afterwards. `expiresAt` in the route's 200 body is
  epoch **milliseconds** (`exp * 1000`), as `MapKitTokenResult` has always
  documented; the README said seconds and was wrong.

  **A 500 says one constant sentence.** The handler's catch used to put
  `error.message` on the wire, so a throwing rate-limit hook sent whatever that
  hook had put in its own error — a DSN, a host, an internal path — to the
  browser. Diagnostics now reach the app through its `log` hook only. Every
  response also carries `X-Content-Type-Options: nosniff`, and `Origin: null`
  (an opaque origin, which is by definition not this origin) now refuses instead
  of falling through to `Sec-Fetch-Site`.

  **New: `mapKitRoutedOrigin`**, and `self` accepts `null`. h3 documents
  `getRequestURL().origin` as spoofable, and it is: Node's server accepts an
  absolute-form request line (`GET https://evil.example/... HTTP/1.1`), and
  `new URL(absolute, base)` ignores the base — so the request line, not the
  routed host, named the `origin` claim. `mapKitRoutedOrigin` prefers the routed
  Fetch `Request` where the adapter has one (always, on Cloudflare Workers) and
  answers `null` for a request target that is not origin-form; `self: null` is
  refused with 403 before the limiter and before signing, never guessed at. A
  forged `Host:` on an ordinary target remains a Node deployment's own
  responsibility and is called out in the README. The `./node` entry now spreads
  the caller's options into the handler rather than forwarding three of them by
  name, so `self` and `log` stop being silently dropped there.

  **`tokenEndpoint` must be relative, and is now checked.** §b.1 always called
  an absolute URL a config error; `initializeMapKit` and `fetchMapKitToken` now
  throw one instead of making a cross-origin fetch for a token Apple would
  refuse on this page anyway.

  **The rate-limit hook is part of the handler, not a path-matched middleware.**
  A limiter mounted by path is bypassable by URL spelling — a trailing slash,
  different case, a doubled slash, an added query string — so the hook is
  consulted inside the handler, before any signing work, and the variants are
  tested (folded in from the buoys PR #122 F1 review finding).

  `@apple/mapkit-loader` moves from a devDependency to a dependency; it is
  imported dynamically so the `./server`, `./node`, `./worker`, and `./token`
  entry points never reach it.

### Patch Changes

- 5fa4084: Document the 2.1.0 API surface in `docs/api-2.1.md`: the exports map,
  the Nuxt module options and environment variable names, the `<AppMapKit>`
  prop/emit/slot/expose contract, the Apple loader and token-refresh contract,
  the same-host token route, testable performance budgets, the `./testing` fake,
  and the honest list of what remains unverified. Documentation only — no
  runtime code changes in this release.

## 2.0.2

### Patch Changes

- 05515cd: Add the required `mapkit_js` scope to dynamically signed MapKit JS
  tokens so Apple accepts the token at its JavaScript bootstrap endpoint.

## 2.0.1

### Patch Changes

- 33805d0: Moved from the standalone `narduk-mapkit` repository into
  `narduk-libs` at `packages/modules/narduk-mapkit`, with full git history
  preserved. The package name, version line, export map, `dist/` contents and
  runtime behaviour are unchanged; what changed is the repository it builds and
  publishes from. It now runs the shared `@narduk-enterprises/eslint-config`,
  Prettier, and the Turbo `lint`/`typecheck`/`build`/`test:unit`/`check:package`
  script contract that `ci / Required` drives, and it releases through
  narduk-libs' Changesets pipeline instead of its own workflow.

## 2.0.0 - 2026-08-28

- **Breaking: npm scope renamed** from `@narduk-geo` to `@narduk-enterprises`.
  `@narduk-geo/narduk-mapkit` is now `@narduk-enterprises/narduk-mapkit`, and
  `@narduk-geo/narduk-mapkit-nuxt` is now
  `@narduk-enterprises/narduk-mapkit-nuxt`. `@narduk-geo` is a retired estate
  npm scope (narduk-enterprises/company-hq `DECISIONS.md`, 2026-07-25
  estate-shape decision: "npm scope consolidates to `@narduk-enterprises`").
  Versions through 1.3.0 remain published under the old `@narduk-geo` scope and
  are unaffected; this release is the first to publish (on its own future tag)
  under `@narduk-enterprises`. Update the scoped-registry line in `.npmrc` from
  `@narduk-geo:registry=...` to `@narduk-enterprises:registry=...` and every
  import specifier from `@narduk-geo/narduk-mapkit*` to
  `@narduk-enterprises/narduk-mapkit*`. No runtime behavior changed — this is
  the identifier only.
- Added a doc note to `docs/centralization-plan.md` (D1) recording that web
  scalar/grid rendering lives in `GeoGridWeb`, not this package; the tile seam
  (`createMapKitAsyncTileOverlay`, `MapKitTileOverlayImageSource`) stays a plain
  structural type rather than a dependency.

## 1.6.0 - 2026-08-28

- Added `MapKitPinScalingController` / `createMapKitPinScalingController()`:
  zoom-adaptive size, dot-versus-symbol mode, and rank culling over the live
  annotations of a `MapKitAnnotationRegistry`, addressed by key. It composes
  with the registry rather than replacing it -- the registry keeps owning which
  annotations exist, and the controller owns what they look like at the current
  zoom.
- Continuous scaling is published as CSS custom properties on one container
  element (`MAPKIT_PIN_SIZE_PROPERTY` / `--mapkit-pin-size`, a `px` length, and
  `MAPKIT_PIN_SCALE_PROPERTY` / `--mapkit-pin-scale`, unitless), so a zoom
  gesture costs two property writes per frame for any number of pins and
  creates, destroys, and rewrites nothing. Structural state is latched per
  _class_ rather than per pin, so a frame costs O(classes) and only a class that
  actually crossed a threshold touches its members; the change event names
  exactly those keys, batched into one frame, and never names a culled pin.
- Every threshold is latched with tunable hysteresis (`dotPx` 1.5, `rankZoom`
  0.25, `stepZoom` 0.15), and the three latches are exported as pure functions
  in their own right: `latchedStepIndex()`, `latchedPinMode()`, and
  `cullProbeZoom()`. Culling applies its deadband to the question rather than
  the answer, which keeps it at two rank-floor evaluations per frame.
- Added `createMapKitPinSizeCurve()`, `defaultMapKitPinSizeCurve`,
  `defaultMapKitPinSizeStops` (5px at z5 to 26px at z10), and
  `DEFAULT_MAPKIT_PIN_DOT_BELOW_PX`. A curve is a plain `(zoom) => px` function,
  so consumers can supply their own, and a class may carry its own through
  `sizeCurve`, which publishes a scoped `--mapkit-pin-size-<class>` /
  `--mapkit-pin-scale-<class>` pair. `'linear'` interpolation is the default and
  hits every anchor exactly; `'step'` reproduces the classic ladder.
- Added `defaultMapKitPinRankFloor()` and the `MapKitPinRankFloor` shape: the
  lowest class rank that survives a given zoom, so the least distinctive classes
  drop out first as the camera pulls back.
- Added `mapKitZoomForSpan()`, which derives a web-mercator zoom from the
  documented `region.span.longitudeDelta` and the rendered element width.
  `mapkit.Map` exposes no public `zoomLevel` and no `camera`, and
  `cameraDistance` needs both a latitude correction and MapKit's own
  field-of-view constant, so the span is the only public-API source.
- `beginGesture()` / `endGesture()` follow the camera continuously through the
  injectable frame scheduler. MapKit JS publishes only bracket pairs
  (`region-change-start`/`-end`, `zoom-start`/`-end`, `scroll-start`/`-end`) and
  no continuous camera event, so scaling during a pinch means reading the camera
  once per animation frame between the brackets. There is no polling at rest,
  and a consumer that wires nothing but `region-change-end` degrades to
  end-of-gesture snapping.
- `select()` / `deselect()` / `setSelection()` exempt a pin from culling and
  from dot mode; `shouldPaint` defers repaints for pins outside the viewport and
  `flushDeferred()` releases them after a pan, while culling still applies
  immediately. `visible` is written only when the controller is changing it, and
  `destroy()` restores exactly the pins it culled, removes exactly the
  properties it published, and leaves the registry alone.
- Documented the module, the README `Pin Scaling` section, and
  `examples/pin-scaling.ts`, including what MapKit JS actually provides and the
  MapKit JS 5 caveat that a map carrying a `TileOverlay` snaps to integral zoom
  levels.
- Added `createMapKitCalloutController()` / `MapKitCalloutController`: anchored
  callouts for map annotations, as a controller-owned overlay layer keyed to the
  same identities `MapKitAnnotationRegistry` uses. `open()`, `close()`,
  `closeAll()`, `toggle()`, `reposition()`, `repositionNow()`, `destroy()`,
  `subscribe()`, `hostFor()`, `itemFor()`, `layoutFor()`, `isOpen()`,
  `openKeys`, `size`, `mode`, `following`, and `destroyed` make up the surface.
  `'single'` mode replaces the open callout, `'multi'` keeps them all. Nothing
  is created until `open()` is called, and no DOM global is touched at import
  time.
- MapKit's native callout delegate (`calloutElementForAnnotation` and friends)
  was evaluated and rejected, documented in the module, the README, and the Nuxt
  adapter: it owns the element's lifetime with no teardown hook, so a framework
  subtree mounted into it is orphaned rather than unmounted; it is bound to
  `map.selectedAnnotation` so only one callout can ever be open; its anchor
  offset is computed once with no edge-avoidance; and it requires the `mapkit`
  global that this core deliberately does not import.
- Added `layoutMapKitCallout()`, the pure placement function behind the
  controller: flip on the main axis, shift on the cross axis with a caret that
  tracks the shift, and clamp inside the container as a last resort, each
  reported separately in the returned layout.
- Callouts follow the camera through one shared animation frame rather than a
  listener or frame loop per callout, and a flush projects and measures every
  open callout before writing any of them, so N open callouts cost one forced
  layout per frame. Frame scheduling is injectable through `frame`, and
  `document` / `window` are injectable as elsewhere in the client.
- Added the `render(context, host) => cleanup` content contract with an opt-in
  `update(context, host)`: with an updater, re-opening an open key keeps the
  mounted content and its cleanup alive; without one it tears the content down
  and renders it again. `close()`, `closeAll()`, and `destroy()` all run the
  cleanup.
- Added dismissal options -- `closeOnEscape` and `closeOnMapClick` default on,
  `closeOnDeselect` (narrowed to one callout with `keyForAnnotation`), and
  `closeOnPan` off because the default is to follow the camera -- plus
  `focusOnOpen` / `restoreFocus`, a configurable `role`, and `ariaLabel`.
- Added `MAPKIT_CALLOUT_ATTRIBUTE`, `MAPKIT_CALLOUT_LAYER_ATTRIBUTE`,
  `MAPKIT_CALLOUT_CARET_ATTRIBUTE`, `MAPKIT_CALLOUT_CONTENT_ATTRIBUTE`, and
  `MAPKIT_CALLOUT_PLACEMENT_ATTRIBUTE`, so consumers can style callout chrome
  without hardcoding the attribute names.
- Added `AppMapKitCallout` to the Nuxt adapter: a slot-based component that
  teleports its scoped slot into the controller-owned host, one Teleport per
  open callout. A Teleport rather than a second mounted app, so the content
  keeps its place in the component tree and Nuxt UI components still reach
  `<UApp>`'s configuration through `provide`/`inject`.
- Added `useMapKitCallouts()` for the same controls from anywhere inside the
  map's subtree.
- `AppMapKit` gained an opt-in `callouts` prop (default `false`) plus
  `calloutMode`, `calloutPlacement`, `calloutAnchorOffset`,
  `calloutFollowSelection`, and a `calloutOptions` passthrough; `callout-open`
  and `callout-close` events; and `openCallout()` / `closeCallout()` /
  `closeCallouts()` / `getCalloutController()` on its exposed handle. Selection
  and callouts stay in step in both directions, and the controller is destroyed
  before unmount so no teleported subtree is stranded.

## 1.5.0 - 2026-08-28

- Added `createMapKitFullscreenController()` / `MapKitFullscreenController`:
  two-mode fullscreen presentation for a map surface. `'viewport'` -- the
  default everywhere a default exists -- makes the element a fixed overlay
  filling the browser viewport; `'fullscreen'` uses the Fullscreen API and falls
  back to viewport mode when the API is missing (iPhone Safari has no element
  fullscreen) or the request is refused, reporting the fallback in the change
  event rather than failing. Viewport mode saves and restores the element's
  inline `style.cssText`, sets `data-mapkit-fullscreen` as a styling hook, locks
  and restores document scrolling, and exits on Escape; native mode tracks an
  external exit through `fullscreenchange` and runs the same restore path.
  `enter()`, `exit()`, `toggle()`, `destroy()`, `subscribe()`, `active`, `mode`,
  and `supportsNativeFullscreen` make up the surface, and `document` / `window`
  are injectable as in `MapKitClientOptions`. Nothing is presented until a
  consumer constructs the controller and calls it, and no DOM global is touched
  at import time.
- Added the `onLayout` hook, called after every geometry change and before the
  subscribers, so a consumer can settle layout with the existing
  `refreshMapKitMapLayout(map)` before rendering chrome.
- Added `MAPKIT_FULLSCREEN_ATTRIBUTE`, the `data-mapkit-fullscreen` attribute
  name, so consumers can style the presented element without hardcoding it.
- Documented the containing-block caveat in the module, the README, and the Nuxt
  adapter: an ancestor with `transform`, `filter`, `backdrop-filter`,
  `perspective`, or `contain: paint` becomes the containing block for a
  fixed-position element and traps viewport mode inside it. The controller
  deliberately does not reparent the element, because moving a live MapKit
  canvas in the DOM loses map state.
- `AppMapKit` gained an opt-in `fullscreenControl` prop (default `false`) plus
  `fullscreenMode` (default `'viewport'`), a `fullscreen-change` event, and
  `enterFullscreen()` / `exitFullscreen()` / `toggleFullscreen()` /
  `isFullscreen` on its exposed handle. The component presents its own wrapper
  so the map chrome comes along, refreshes MapKit geometry on every change, and
  destroys the controller before unmount.

## 1.4.0 - 2026-08-28

- Added `MapKitAnnotationRegistry`: keyed annotation reconciliation so an
  unchanged marker is never removed, re-added, or mutated. Each descriptor
  carries a `key`, a consumer-defined `signature`, a `create()` factory, and an
  optional in-place `update()` hook; `reconcile()` diffs against the previous
  set, batches every removal into one `removeAnnotations` call and every
  addition into one `addAnnotations` call, and makes no host call at all when
  nothing changed. This replaces the `removeAnnotations(all)` +
  `addAnnotations(next)` pattern that rebuilds and visibly blinks every marker
  on each render.
- Added `createMapKitRenderScheduler()`: coalesces many `mark(region)` calls
  into one flush per animation frame, with `flushNow()`, `cancel()`,
  `destroy()`, injected animation frames, and re-entrant marks deferred to a
  follow-up frame rather than recursing.
- Added `createMapKitHtmlSlotRenderer()`: remembers the last HTML written per
  element in a `WeakMap` and skips byte-identical `innerHTML` writes, plus
  `forget()` and `writeAll()`.
- Added `createMapKitFocusPreserver()`: captures the focused element's stable
  key and selection range before a batch of slot writes and restores it after,
  so a rewrite does not drop the user's caret.
- Added `MapKitFrameScheduler` / `defaultMapKitFrameScheduler` to `timers.js` as
  the shared injectable animation-frame surface.
  `crossfadeMapKitOverlayOpacity()` now uses it instead of its own private copy;
  behavior is unchanged.
- Bumped `@narduk-geo/narduk-mapkit-nuxt` to the same version with no source
  change; the release workflow requires both workspace packages to carry
  identical versions.

## 1.3.0 - 2026-08-28

- Added `createTemporalLayerController()` / `MapKitTemporalLayerController`,
  which binds the existing temporal playback primitives to one
  `MapKitLayerRegistry` layer: scrub by index or date id, step, readiness-gated
  looping over the last N dates at a configurable interval, bounded prefetch,
  failed-frame skipping, change/readiness/stall/error events, and a consumer-set
  reduced-motion flag that refuses looping and makes every scrub instant.
- Added `normalizeTemporalFrames()` and the `TemporalFrame` shape so a dated
  sequence can carry per-date consumer metadata without the core knowing what it
  means.
- Added `attachMapKitPointerProbe()` / `MapKitPointerProbe`: unified pointer
  plumbing for map probing with throttled hover (default 90ms), click-to-pin,
  touch tap-to-pin, long-press-to-pin (default 500ms) with movement and duration
  disambiguation from a pan, pin-drag repositioning, dismissal, and a single
  `{ mode, phase, point, coordinate, pointer, source }` event surface. It works
  against any element that supports `addEventListener` plus an injected
  coordinate-conversion callback, so it stays engine-agnostic and testable
  without MapKit JS.
- Added `MapKitTimerScheduler` so both new primitives accept an injected clock
  and are deterministic under test.
- Documented the previously undocumented temporal playback primitives
  (`nextDrawableFrame`, `temporalProgress`, `boundedFrameCache`,
  `FrameReadiness`, `TemporalPlaybackState`) in the README.
- Bumped `@narduk-geo/narduk-mapkit-nuxt` to the same version with no source
  change; the release workflow requires both workspace packages to carry
  identical versions.

## 1.2.0 - 2026-07-19

- Added `MapKitLayerRegistry.reconcile()` for multi-dataset tile stacks: sync a
  desired layer set in one call with independent opacity, register/unregister by
  id, and replace only when the tile source identity changes.
- Added `layerSourceIdentity()` so consumers can fingerprint urlTemplate /
  bounds / z-range (or async `data`) without comparing opacity.

## 1.1.1 - 2026-07-16

- Made zero-duration layer replacement construct the incoming overlay at its
  final opacity before retiring the previous overlay. This avoids Safari
  MapKit's unreliable repainting after mutable `TileOverlay.opacity` changes.

## 1.1.0 - 2026-07-16

- Added MapKit JS 6 core-library loading and asynchronous `Promise<ImageSource>`
  tile-overlay construction.
- Extended `MapKitLayerRegistry` to own async overlay replacement, first-image
  readiness, bounded fallback activation, error reporting, and stale-overlay
  retirement.

## 1.0.0 - 2026-07-16

- Established this `narduk-geo/narduk-mapkit` repository as the canonical
  two-package workspace.
- Added public `@narduk-geo/narduk-mapkit-nuxt` with `AppMapKit`, `useMapKit`,
  `useMapkitToken`, Nuxt module registration, and a Worker-compatible token
  route that retains the unconfigured `503` contract.
- Added the `@narduk-geo/narduk-mapkit/apple-maps` access-token, search, and
  geocode API.
- Added idempotent vector-overlay helpers from the preserved legacy checkout.
- Added the Earthdata tile-intersection decision cache, bounded at 2,048 entries
  and shared across scale variants.
- Pointed package metadata at `github.com/narduk-geo/narduk-mapkit` and added
  public-npm, `publint`, Nuxt production-build, and packed-consumer gates.
- Added `refreshMapKitMapLayout` so consumers can refresh MapKit viewport
  geometry after responsive container or drawer layout changes.
- Split the token runtime into Web-standard `/server` and `/worker` exports and
  an explicit Node-only `/node` export for `process.env` and Doppler CLI lookup.
- Added warning-free Cloudflare module and packed-consumer gates that reject
  Node built-ins and prove GET-only `503`, `403`, `200`, and binding behavior.
- Added an app-owned token rate-limit hook with `429`/`Retry-After` support.
- Removed the mutable local-tarball publish poller and its `latest.tgz` channel.
- Removed Austin-specific fallback coordinates and property fields from the
  generic Nuxt map component.

## 0.3.1

- Fixed a critical bug in `createBoundsGatedUrlTemplate`'s function-form
  `urlTemplate`: real MapKit JS invokes it as `(x, y, z, scale)`, not
  `(x, y, scale, z)`. The wrong order meant every bounds-gated overlay silently
  computed tile bounds using the scale factor as the zoom level (almost always
  `1`), which gated out every real tile request as out-of-bounds -- overlays
  rendered nothing, with no error. Confirmed against the real MapKit JS SDK, not
  just documentation.

## 0.3.0

- Added a MapKit JS layer registry for multiple live tile overlays with
  independent opacity.
- Added bounds-gated tile URL templates that short-circuit outside-AOI tile
  requests to a transparent PNG.
- Added AOI-aware layer region helpers that tighten default minimum spans for
  small layer bounds.
- Added layer registry documentation and an example showing two simultaneous AOI
  raster layers.

## 0.2.0

- Added reusable MapKit JS runtime helpers for coordinates, regions, tile
  overlays, and cancellable overlay opacity crossfades.
- Added shared region helpers for point lists, lng/lat bounds, GeoJSON, and
  common drawable collections.
- Added bounded server-side caching for origin-scoped signed MapKit JS tokens.
- Coalesced concurrent browser token refreshes during MapKit authorization
  callbacks.
- Hardened signed-token cache partitioning across Apple private-key rotation.
- Added Hono, Nuxt, browser marker, and animated tile overlay examples.
- Added package export and clean-room tarball install smoke validation to the
  canonical quality gate.
- Added contributor and security policy docs for production library maintenance.
- Updated CI to run on push and pull requests with a portable Node job.
- Updated package metadata and license for public open-source distribution.

## 0.1.1

- Initial framework-agnostic MapKit JS token, browser initialization, geometry,
  and playback helpers.
