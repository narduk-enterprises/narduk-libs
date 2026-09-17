# Changelog

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
