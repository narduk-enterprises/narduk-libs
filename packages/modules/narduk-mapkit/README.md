# Narduk MapKit

Canonical Apple MapKit JS workspace for Narduk web apps. It publishes two
public, independently versioned packages through GitHub Packages:

- `@narduk-geo/narduk-mapkit` — framework-neutral client, server, token,
  geometry, temporal, vector-overlay, and Apple Maps Server API helpers.
- `@narduk-geo/narduk-mapkit-nuxt` — `AppMapKit`, `useMapKit`,
  `useMapkitToken`, Nuxt registration, and `/api/mapkit-token`.

This package centralizes the mapping code Narduk apps keep repeating: MapKit JS
token routes, browser bootstrapping, coordinate and region math, GeoJSON and
drawable framing, tile overlay animation, and route playback utilities.

Core stays runtime-neutral. The Nuxt adapter owns only reusable framework
integration; consuming apps still own marker HTML, panels, data fetching, and
domain-specific behavior.

## Features

- Origin-scoped MapKit JS JWT signing with Web Crypto.
- Fetch-compatible token responses for Hono, Workers, Nuxt/H3, Next route
  handlers, and plain server runtimes.
- Bounded in-memory token caching so repeated requests do not reimport/sign the
  same Apple key.
- Browser script loading and MapKit initialization with token refresh
  coalescing.
- Plain-data geometry helpers for bounds, GeoJSON, drawables, distance, hit
  testing, and route playback.
- MapKit JS runtime helpers for coordinates, coordinate regions, tile overlays,
  and cancellable opacity crossfades.
- MapKit JS 6 async image-source overlays with first-image lifecycle reporting
  and bounded replacement readiness.
- A MapKit JS layer registry for multiple live AOI tile overlays with
  independent opacity, bounds-gated tile URLs, and replacement fades.
- A keyed annotation registry that reconciles markers by signature, so an
  unchanged marker is never removed, re-added, or mutated.
- Render coalescing: many dirty-region marks collapse into one flush per
  animation frame, identical HTML writes are skipped, and focus survives a
  slot rewrite.
- Temporal playback state for dated raster layers: frame readiness, decoded
  progress, and a bounded frame cache.
- A temporal layer controller that binds a dated frame list to one registry
  layer: scrub, step, readiness-gated looping over the last N dates, bounded
  prefetch, change events, and a reduced-motion switch.
- Pointer probe plumbing: throttled hover, click-to-pin, touch tap-to-pin,
  long-press-to-pin with pan disambiguation, pin dragging, and dismissal from
  one engine-agnostic recognizer.
- Two-mode fullscreen for a map surface: a fixed viewport overlay that works
  everywhere, the real Fullscreen API where it exists, and an automatic fallback
  from the second to the first.
- Idempotent vector-overlay attachment and bounded tile-intersection caching.
- Apple Maps access-token exchange, search, and geocoding helpers.
- A separately published Nuxt adapter with no dependency on Narduk template
  layers or UI packages.

## Install

Configure the scoped registry with a GitHub token that has `read:packages`:

```ini
@narduk-geo:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```sh
pnpm add @narduk-geo/narduk-mapkit
```

Nuxt apps install both immutable releases:

```sh
pnpm add @narduk-geo/narduk-mapkit @narduk-geo/narduk-mapkit-nuxt
```

```ts
export default defineNuxtConfig({
  modules: ['@narduk-geo/narduk-mapkit-nuxt'],
})
```

Do not use mutable Git branches, absolute tarball paths, or vendored source in
production consumers. Publish immutable SemVer packages and pin or range those
versions normally.

## Nuxt integration

The adapter auto-registers `AppMapKit`, `useMapKit`, `useMapkitToken`, and the
token route. The component fills its parent, so the parent must establish an
explicit height. The adapter has no Nuxt UI or color-mode-module dependency.

Missing token credentials return `503` with `configured: false`; disallowed
origins return `403`. See `packages/nuxt/README.md` for options and runtime
configuration.

## Server Token Route

Mount the Fetch handler at your app's token endpoint:

```ts
import { createMapKitTokenHandler } from '@narduk-geo/narduk-mapkit/node'

export const GET = createMapKitTokenHandler({
  allowedOrigins: ['http://localhost:3000', 'https://maps.example.com'],
})
```

The response shape is stable:

```json
{
  "configured": true,
  "expiresAt": "2026-07-05T14:00:00.000Z",
  "origin": "http://localhost:3000",
  "token": "..."
}
```

Misconfiguration returns `503` with `configured: false`; blocked origins return
`403`. The `/node` entry point is the only surface that reads `process.env` or
uses the optional Doppler CLI fallback. Use `/server` or `/worker` with explicit
configuration in Web-standard runtimes.

### Cloudflare Workers

Workers pass secrets through `fetch(request, env)`, not `process.env`:

```ts
import { mapKitTokenResponseFromEnv } from '@narduk-geo/narduk-mapkit/worker'

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === '/api/mapkit-token') {
      return mapKitTokenResponseFromEnv(request, env, {
        allowedOrigins: env.MAPKIT_ALLOWED_ORIGINS,
      })
    }
    return new Response('Not found', { status: 404 })
  },
}
```

Narduk projects should source these values through Doppler, for example:

```sh
doppler run -- pnpm dev
```

Cloudflare Workers should receive the same names through Worker secrets or
bindings. Recognized runtime names:

- `APPLE_PRIVATE_KEY` or `APPLE_SECRET_KEY`
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `MAPKIT_ALLOWED_ORIGINS`
- `MAPKIT_TOKEN` or `APPLE_MAPKIT_TOKEN` as a fallback static JWT

`APPLE_PRIVATE_KEY` must be PKCS#8 PEM with `BEGIN PRIVATE KEY`. Escaped
newlines are accepted.

## Apple Maps Server API

Core signs or accepts a Maps auth JWT, exchanges it for an access token, caches
that token until its refresh window, and exposes framework-neutral search and
geocode calls:

```ts
import {
  geocodeAppleMaps,
  getAppleMapsAccessToken,
  searchAppleMaps,
} from '@narduk-geo/narduk-mapkit/apple-maps'

const serverConfig = {
  appId: 'maps.example.app',
  keyId: env.APPLE_KEY_ID,
  privateKey: env.APPLE_PRIVATE_KEY,
  teamId: env.APPLE_TEAM_ID,
}

const accessToken = await getAppleMapsAccessToken(serverConfig)
const places = await searchAppleMaps('marina', {
  accessToken,
  searchLocation: { lat: 30.2672, lng: -97.7431 },
})
const addresses = await geocodeAppleMaps('1100 Congress Ave, Austin, TX', {
  accessToken,
  limitToCountries: 'US',
})
```

`APPLE_MAPS_APP_ID` is distinct from a raw bundle ID and is required when the
library signs a Maps Server API developer token. Apps may instead provide a
fresh pre-signed auth JWT as `authToken`.

## Browser Boot

```ts
import { initializeMapKit } from '@narduk-geo/narduk-mapkit/client'

await initializeMapKit({ tokenEndpoint: '/api/mapkit-token' })

const map = new window.mapkit.Map('map')
```

`initializeMapKit()` is a singleton. It shares the script load, initializes
MapKit once, reuses fresh tokens until they approach expiry, and coalesces
concurrent token refreshes.

For MapKit JS 6 async tile sources, load the core bundle and map libraries:

```ts
import {
  MAPKIT_JS_V6_SCRIPT_URL,
  initializeMapKit,
  loadMapKitLibraries,
} from '@narduk-geo/narduk-mapkit/client'

const mapkit = await initializeMapKit({
  scriptUrl: MAPKIT_JS_V6_SCRIPT_URL,
  tokenEndpoint: '/api/mapkit-token',
})
await loadMapKitLibraries(mapkit)
```

## Shared Region Framing

Use package geometry to keep bounds logic out of app components:

```ts
import { computeMapKitRegionForDrawables } from '@narduk-geo/narduk-mapkit/geometry'
import { createMapKitRegionForPoints } from '@narduk-geo/narduk-mapkit/client'

const plainRegion = computeMapKitRegionForDrawables({
  markers: [{ id: 'austin', lat: 30.2672, lng: -97.7431 }],
  geojson: featureCollection,
})

const mapkitRegion = createMapKitRegionForPoints(window.mapkit, points, {
  fallbackCenter: { lat: 30.2672, lng: -97.7431 },
  fallbackSpan: { latDelta: 0.12, lngDelta: 0.12 },
  padding: 0.16,
})

if (mapkitRegion) map.setRegionAnimated(mapkitRegion)
```

Region helpers handle invalid points, minimum spans, padding, and antimeridian
crossings.

## Tile Overlay Crossfade

Map viewers can share tile overlay construction and fade-out cleanup:

```ts
import {
  createMapKitTileOverlay,
  crossfadeMapKitOverlayOpacity,
} from '@narduk-geo/narduk-mapkit/client'

const nextOverlay = createMapKitTileOverlay(window.mapkit, '/tiles/{z}/{x}/{y}.png', {
  maximumZ: 10,
  minimumZ: 3.33,
  opacity: 0,
})

map.addTileOverlay(nextOverlay)

void crossfadeMapKitOverlayOpacity({
  durationMs: 520,
  nextOverlay,
  oldOverlays: [currentOverlay],
  removeOverlay: (overlay) => map.removeTileOverlay(overlay),
  targetOpacity: 0.82,
}).finished
```

## Layer Registry

Use the layer registry when a map needs multiple raster layers live at the same
time, each with its own opacity and AOI bounds:

```ts
import {
  MapKitLayerRegistry,
  regionForMapKitLayer,
} from '@narduk-geo/narduk-mapkit/client'

const registry = new MapKitLayerRegistry({
  mapkit: window.mapkit,
  map,
  crossfadeDurationMs: 400,
})

const vegetation = {
  id: 'vegetation',
  urlTemplate: '/tiles/vegetation/{z}/{x}/{y}@{scale}x.png',
  bounds: [-97.706, 30.198, -97.692, 30.209] as const,
  minimumZ: 10,
  maximumZ: 16,
  opacity: 0.6,
}

map.region = regionForMapKitLayer(window.mapkit, vegetation)

registry.register(vegetation)
registry.register({
  id: 'moisture',
  urlTemplate: '/tiles/moisture/{z}/{x}/{y}@{scale}x.png',
  bounds: vegetation.bounds,
  minimumZ: 10,
  maximumZ: 16,
  opacity: 0.4,
})

await registry.replace('vegetation', {
  ...vegetation,
  urlTemplate: '/tiles/vegetation/next/{z}/{x}/{y}@{scale}x.png',
})
```

MapKit JS 6 consumers can register authenticated or cache-backed image
providers directly. Waiting for the first usable image is bounded, so a
provider that never signals readiness cannot leave the previous layer visible
forever:

```ts
registry.register({
  id: 'farm-imagery',
  imageForTile: (x, y, z, scale) => provider.imageForTile(x, y, z, scale),
})

await registry.replace(
  'farm-imagery',
  {
    id: 'farm-imagery',
    imageForTile: (x, y, z, scale) => nextProvider.imageForTile(x, y, z, scale),
    onTileError: console.error,
  },
  { activateWhen: 'first-image', readinessTimeoutMs: 1500 },
)
```

When `bounds` are present, tile URLs outside the layer extent resolve to a
valid 1x1 transparent PNG data URI before any network request. `replace()`
requires an already-registered id and folds any still-fading overlays for that
id into the next crossfade. Async replacements may activate immediately or on
their first image, with a bounded timeout that guarantees stale overlays are
retired. `unregister()` is a no-op for unknown ids.

## Annotation Registry

`MapKitAnnotationRegistry` is the marker-side sibling of the layer registry.
MapKit JS does no diffing, so the obvious update is
`map.removeAnnotations(all)` followed by `map.addAnnotations(next)` -- which
destroys and rebuilds every marker on every render and makes them blink.
Reconcile by key instead:

```ts
import { MapKitAnnotationRegistry } from '@narduk-geo/narduk-mapkit/client'

const annotations = new MapKitAnnotationRegistry<mapkit.MarkerAnnotation>({ map })

function render(buoys: Buoy[]): void {
  annotations.reconcile(
    buoys.map((buoy) => ({
      key: buoy.id,
      // Everything that changes how the marker looks or reads.
      signature: `${buoy.lat},${buoy.lng}|${buoy.status}|${buoy.label}`,
      create: () =>
        new mapkit.MarkerAnnotation(new mapkit.Coordinate(buoy.lat, buoy.lng), {
          color: statusColor(buoy.status),
          title: buoy.label,
        }),
      update: (annotation) => {
        annotation.coordinate = new mapkit.Coordinate(buoy.lat, buoy.lng)
        annotation.color = statusColor(buoy.status)
        annotation.title = buoy.label
      },
    })),
  )
}
```

Per key, one reconcile does exactly one of four things:

| Key | Signature | Result |
| --- | --- | --- |
| present before and after | unchanged | untouched -- no remove, no re-add, no mutation |
| present before and after | changed | `update()` in place, or recreate that key alone if no hook |
| absent now | -- | removed |
| new | -- | created |

Removals batch into one `removeAnnotations` call and additions into one
`addAnnotations` call; an empty set makes no call at all, so reconciling the
same descriptors twice is a complete no-op. `reconcile()` returns
`{ added, recreated, removed, unchanged, updated }`, which is the cheapest way
to assert in a test that a pan or an opacity tick touched nothing.

The `signature` is the finer-grained analogue of `layerSourceIdentity()`: the
layer registry fingerprints a whole tile source and treats any change other
than opacity as a full replace, while a signature is whatever string the
consumer decides distinguishes one rendering of a marker from another, so a
change can be applied in place.

`register()` / `unregister()` handle one annotation outside a reconcile pass,
`get()` / `has()` / `list()` / `size` inspect the live set, and `destroy()`
clears every annotation and makes the registry inert.

## Pin Scaling

`MapKitPinScalingController` is the presentation-side sibling of the annotation
registry. The registry owns *which* annotations exist; this owns what they look
like at the current zoom -- size, dot-versus-symbol, and rank culling -- over
the registry's live annotations, by key.

The usual implementation of this rewrites every marker's `innerHTML` and
`cssText` on `region-change-end`. With a few thousand pins that is a few
thousand subtree rebuilds per gesture, and because it can only run at the *end*
of a gesture the markers pop rather than scale. This splits the problem:

- **Continuous.** Size between thresholds is one number, published as CSS
  custom properties on a single container element. A zoom gesture costs two
  property writes per frame for *any* number of pins -- no element is created,
  destroyed, or rewritten.
- **Structural.** Dot mode and culling change only at thresholds, and they
  depend on `(class, zoom)` rather than on the individual pin. So the latched
  state lives per class, a frame costs O(classes), and only a class that
  actually crossed touches its members. `changed` names exactly those keys.

```ts
import {
  createMapKitPinScalingController,
  mapKitZoomForSpan,
} from '@narduk-geo/narduk-mapkit/client'

const scaling = createMapKitPinScalingController<mapkit.Annotation>({
  annotations: registry, // the MapKitAnnotationRegistry, unchanged
  classes: {
    'artificial-reef': { rank: 3 },
    buoy: { rank: 4 },
    launch: { dotBelowPx: 0, rank: 9 }, // never collapses to a dot
    'oil-gas-platform': { rank: 2 },
    'tx-state-platform': { rank: 1 }, // drops out first
  },
  container: mapWrapper,
  onChange: (event) => {
    for (const key of event.changed) paintPin(key, scaling.presentationFor(key)!)
  },
  readZoom: () =>
    mapKitZoomForSpan({
      longitudeDelta: map.region.span.longitudeDelta,
      widthPx: map.element.clientWidth,
    }),
})

scaling.reconcile(structures.map((s) => ({ classId: s.class, key: s.id })))

map.addEventListener('zoom-start', () => scaling.beginGesture())
map.addEventListener('zoom-end', () => scaling.endGesture())
map.addEventListener('region-change-end', () => {
  scaling.sample()
  scaling.flushDeferred()
})
```

The container carries `--mapkit-pin-size` (a `px` length) and
`--mapkit-pin-scale` (unitless, relative to `referenceSizePx`). Scale with
`transform`, which composites without layout or paint:

```css
.pin {
  width: 26px; /* the size the artwork is authored at */
  height: 26px;
  transform: translate(-50%, -50%) scale(var(--mapkit-pin-scale, 1));
}
```

### What MapKit JS actually provides

MapKit JS publishes three documented bracket pairs and **no continuous camera
event**: `region-change-start` / `region-change-end` (any region change,
programmatic included), `zoom-start` / `zoom-end`, and `scroll-start` /
`scroll-end` (user interaction only). The `end` of each pair fires after
momentum settles, not on gesture release, and the only continuous event in the
API is `dragging`, which is about annotation drags.

So smooth scaling *during* a pinch is only possible by reading the camera once
per animation frame between the brackets. That is exactly what `beginGesture()`
starts and `endGesture()` stops, through the injectable frame scheduler -- and
there is no polling at rest. A consumer that wires nothing but
`region-change-end` still works; it degrades to end-of-gesture snapping.

Zoom is derived, not read: `mapkit.Map` exposes no public `zoomLevel` and no
`camera`. `mapKitZoomForSpan()` inverts the documented
`region.span.longitudeDelta` against the rendered element width, using the same
`worldSize(z) = 256 * 2 ** z` convention MapKit uses internally. Longitude
rather than latitude, and span rather than `cameraDistance`, because in web
mercator the x pixel position is linear in longitude at every latitude, so the
ratio is latitude-invariant; `cameraDistance` is a metric distance whose
conversion needs both a latitude correction and MapKit's own field-of-view
constant, neither of which is public API.

Culling writes `annotation.visible`, which is Apple's own documented advice for
this problem -- *"if there's a dense cluster of annotations at low zoom levels,
it's good practice to hide some annotations"* -- and, unlike
`removeAnnotations()`, leaves the host object and its DOM element intact so the
pin is not rebuilt when it returns.

One caveat on MapKit JS 5: a map carrying a `TileOverlay` snaps to integral zoom
levels there, so the camera reports whole numbers and the continuous path
degrades to the same steps a `'step'` curve produces. MapKit JS 6 removed that
snapping.

### Hysteresis

Every threshold is latched, so a camera parked on a boundary cannot thrash.
Defaults are `dotPx: 1.5`, `rankZoom: 0.25`, and `stepZoom: 0.15`; all three are
tunable through `hysteresis`. The three latches are exported as pure functions
in their own right -- `latchedStepIndex()`, `latchedPinMode()`, and
`cullProbeZoom()`.

Culling is a predicate over zoom rather than a scalar band, so its deadband is
applied to the *question*: a visible pin is asked whether it survives slightly
further out, a hidden one whether it qualifies slightly further in. Because the
rank floor is non-increasing, that makes both directions require real movement,
and it collapses to two floor evaluations per frame however many pins there are.

### Size curve

`createMapKitPinSizeCurve()` builds a pure `zoom -> px` function from ascending
anchors. The shipped anchors run 5px at z5 to 26px at z10, flat outside that
range. `'linear'` (the default) hits each anchor exactly and grows continuously
between them; `'step'` reproduces the classic `if (zoom <= 5) return 5` ladder
for consumers rasterising artwork at fixed sizes. Any function of the same shape
works, and a class may carry its own through `sizeCurve`, which publishes a
scoped `--mapkit-pin-size-<class>` / `--mapkit-pin-scale-<class>` pair beside the
base ones.

### Scale, selection, and viewport

- **`changed` never names a culled pin.** There is nothing on screen to repaint,
  and it re-enters `changed` the moment its class becomes visible again -- so a
  dot crossing that happens while a class is hidden costs nothing.
- **`shouldPaint`** gates delivery, normally on the viewport. A refused key is
  counted in `deferred` and released by `flushDeferred()` after a pan. Culling
  still applies immediately; only the repaint waits.
- **A selected pin is exempt** from culling and from dot mode, and a class flip
  does not touch it. `select()`, `deselect()`, and `setSelection()` manage it.
- **`visible` is written only when the controller is changing it.** A pin is
  assumed visible when first tracked, so registering thousands of on-screen pins
  writes no annotation state at all.
- **`destroy()`** restores exactly the pins it culled, removes exactly the
  properties it published, cancels the pending frame, and goes inert. It does
  not touch the registry.

Measured against 2,000 synthetic pins in four classes (`tests/scaling.test.ts`):
a frame between thresholds is 2 property writes and 0 annotation writes; a
repeated reading is 0 of both and emits nothing; a full z11 -> z4 sweep in 0.05
steps writes `visible` exactly once per pin that actually left, and names no pin
for repainting more than twice; and 200 ticks dithering across two thresholds
produce zero writes and zero repaints.

## Temporal Layers

### Playback state primitives

Three plain-data helpers describe a dated raster sequence. They hold no MapKit
reference and are usable on their own:

```ts
import {
  boundedFrameCache,
  nextDrawableFrame,
  temporalProgress,
} from '@narduk-geo/narduk-mapkit/client'

// Advancing only when the current *and* next frames are decoded is what stops
// a time-lapse from flashing an empty layer.
const next = nextDrawableFrame({ current, frameCount, readiness })

// Fraction of the sequence that is decoded, for a load indicator.
const decoded = temporalProgress({ current, frameCount, readiness })

// Cap what stays warm, dropping the oldest insertion first.
const warm = boundedFrameCache(frames, 8)
```

`FrameReadiness` is `'idle' | 'loading' | 'ready' | 'failed'` and
`TemporalPlaybackState` is `{ current, frameCount, readiness }`.

### Temporal layer controller

`createTemporalLayerController` binds those primitives to one registry layer.
It owns index state, readiness bookkeeping, bounded prefetch, and a
readiness-gated loop; the app owns the date strip, the play button, and the
descriptor for each date:

```ts
import { createTemporalLayerController } from '@narduk-geo/narduk-mapkit/client'

const controller = createTemporalLayerController({
  registry,
  layerId: 'data',
  frames: ['2026-08-24', { id: '2026-08-25', meta: { observedFraction: 0.62 } }],
  descriptorForFrame: (frame) => ({
    id: 'data',
    urlTemplate: `/tiles/clarity/${frame.id}/{z}/{x}/{y}@{scale}x.png`,
    bounds,
  }),
  crossfadeDurationMs: 400,
  activateWhen: 'first-image',
  prefetchFrame: (frame, index, signal) => warmTiles(frame.id, signal),
  reducedMotion: media.matches,
  onEvent: (event) => {
    if (event.type === 'change') renderStrip(event.index, event.frame)
    if (event.type === 'readiness') renderProgress(event.progress)
  },
})

await controller.scrubToId('2026-08-25')
await controller.stepBack()
controller.play({ intervalMs: 900, windowSize: 7 })
controller.pause()
```

Behavior worth knowing before wiring a UI to it:

- **Readiness gating is opt-in.** Supplying `prefetchFrame` turns it on: the
  loop will not advance onto a frame whose source has not resolved, and emits a
  `stall` event instead. Without a readiness source every frame reads `ready`
  and `replace()`'s own bounded first-image readiness is the only gate.
- **Failed frames are skipped**, and a window in which every other frame failed
  pauses with reason `stalled` rather than spinning.
- **Reduced motion is a flag the consumer sets.** While it is on, `play()` is
  refused (emitting a `pause` event with reason `reduced-motion`) and every
  scrub crossfades in `0`ms. `setReducedMotion(true)` stops a running loop.
- **Tracked readiness is bounded** by `maxTrackedFrames` (default `8`), and the
  frame currently on screen is never the one evicted.
- **Timers are injectable** through `timer`, so playback is testable without a
  real clock.
- `descriptorForFrame` must return a descriptor whose `id` equals `layerId`.
  The controller throws rather than letting the registry reject the swap
  mid-animation.

## Pointer Probe

`attachMapKitPointerProbe` is the pointer plumbing behind a map readout. One
recognizer covers desktop hover, click-to-pin, touch tap-to-pin,
long-press-to-pin, pin dragging, and dismissal, and separates all of them from
a map pan by movement slop and press duration:

```ts
import { attachMapKitPointerProbe } from '@narduk-geo/narduk-mapkit/client'

const probe = attachMapKitPointerProbe({
  element: mapElement,
  coordinateForPoint: (sample) =>
    map.convertPointOnPageToCoordinate(new DOMPoint(sample.page.x, sample.page.y)),
  hoverThrottleMs: 90,
  longPressDurationMs: 500,
  moveSlopPx: 8,
  isPinHandle: (target) => target instanceof Element && target.closest('.probe-pin') !== null,
  onEvent: (event) => {
    // { mode: 'hover' | 'pinned', phase, point, coordinate, pointer, source }
    if (event.phase === 'dismiss') return clearReadout()
    if (event.coordinate) renderReadout(event.mode, event.coordinate)
  },
})

probe.dismiss()
probe.setEnabled(false)
probe.destroy()
```

The core stays engine-agnostic: it needs an element that supports
`addEventListener` and one `coordinateForPoint` callback, so the whole state
machine is exercisable in Node without a browser or MapKit JS. Notes:

- **Phases** are `begin | move | end | cancel | dismiss`, `mode` is `hover` or
  `pinned`, and `source` says what produced the event (`hover`, `click`, `tap`,
  `long-press`, `drag`, `pan`, `programmatic`).
- **Hover and pin drags share the `hoverThrottleMs` budget**, leading edge plus
  a trailing sample so the final position is never lost.
- **Pan disambiguation**: movement past `moveSlopPx` reclassifies a press as a
  pan, cancels the pending long-press, and blocks the tap. A second concurrent
  pointer (a pinch) does the same.
- **Touch never hovers.** `hoverPointerTypes` defaults to `['mouse', 'pen']`
  and `longPressPointerTypes` to `['touch', 'pen']`.
- **A refused point is not a pin**: return `null` from `coordinateForPoint` and
  the probe emits a `pinned` `cancel` instead of placing one.
- Pin markup is app-owned, so a pin drag starts either from `isPinHandle` or
  from an explicit `beginPinDrag(event)` call on the app's own pin element.
- Set `touch-action: none` on the element so the browser does not consume the
  gesture as a scroll before the recognizer sees it.

## Render Coalescing

A map view usually has many small state changes and one render function that
redraws everything, so each hover tick, opacity step, and date change costs a
full re-render. Two independent pieces cut that down, and they compose.

`createMapKitRenderScheduler()` collapses many marks into one flush per
animation frame:

```ts
import { createMapKitRenderScheduler } from '@narduk-geo/narduk-mapkit/client'

const scheduler = createMapKitRenderScheduler({
  onFlush: (regions) => {
    if (regions.has('markers')) renderMarkers()
    if (regions.has('readout')) renderReadout()
  },
})

scheduler.mark('markers')
scheduler.mark('readout')
scheduler.mark('markers') // still one flush, next frame

scheduler.flushNow() // render synchronously instead of waiting
scheduler.destroy()
```

`region` is a caller-defined string this package never interprets, so a
consumer can redraw only what changed. Marking from inside `onFlush` schedules
a follow-up frame rather than recursing. Animation frames are injectable, so
the scheduler is deterministic under test and safe to import where
`requestAnimationFrame` does not exist.

`createMapKitHtmlSlotRenderer()` drops the DOM write when the markup did not
change -- assigning `innerHTML` rebuilds the subtree even when the string is
identical, which is what makes a re-rendered readout blink:

```ts
import {
  createMapKitFocusPreserver,
  createMapKitHtmlSlotRenderer,
} from '@narduk-geo/narduk-mapkit/client'

const slots = createMapKitHtmlSlotRenderer<HTMLElement>()

slots.write(readoutElement, html) // true when it wrote, false when identical
slots.writeAll([
  { element: legendElement, html: legendHtml },
  { element: readoutElement, html: readoutHtml },
]) // returns how many slots actually changed
```

The remembered strings live in a `WeakMap`, so a detached element is
collectable; call `forget(element)` for any slot something else has written to.

`createMapKitFocusPreserver()` keeps the caret across a rewrite. Element
identity cannot survive replacing `innerHTML`, so focus is restored by a stable
key the render emits:

```ts
const focus = createMapKitFocusPreserver({
  activeElement: () => document.activeElement,
  identify: (element) =>
    element instanceof HTMLElement ? (element.dataset.focusKey ?? null) : null,
  resolve: (key) => panel.querySelector<HTMLElement>(`[data-focus-key="${key}"]`),
})

focus.preserve(() => slots.write(panel, panelHtml))
```

`preserve()` restores even when the write throws, and `capture()` / `restore()`
are available separately for a batch spanning several calls. Selection access
is guarded, because reading `selectionStart` throws on input types that do not
support it.

## Fullscreen

A map wants two different fullscreens, and only one of them works everywhere.

`'viewport'` is the standard mode and the default: the element becomes a fixed
overlay filling the browser viewport. `'fullscreen'` is the real Fullscreen API,
which iPhone Safari does not implement for elements at all -- so an unsupported
or rejected request falls back to viewport mode rather than failing, and says so
in the change event.

Nothing happens until a consumer builds a controller and calls it:

```ts
import {
  createMapKitFullscreenController,
  refreshMapKitMapLayout,
} from '@narduk-geo/narduk-mapkit/client'

const fullscreen = createMapKitFullscreenController({
  element: mapWrapper,
  // Runs after every geometry change, before the subscribers.
  onLayout: () => refreshMapKitMapLayout(map),
})

fullscreen.subscribe((event) => {
  button.setAttribute('aria-pressed', String(event.active))
  if (event.fallback) console.info('native fullscreen unavailable:', event.fallbackCause)
})

await fullscreen.enter() // 'viewport'
await fullscreen.enter('fullscreen') // native, or viewport with fallback: true
await fullscreen.toggle()
fullscreen.destroy()
```

Options are `element` (required), `defaultMode` (`'viewport'`), `zIndex`
(`9999`), `lockScroll` (`true`), `exitOnEscape` (`true`, viewport only -- native
fullscreen already owns Escape), `onLayout`, and injectable `document` /
`window` handles.

Mode semantics, which are the easy part to get wrong:

- `enter(mode)` while already presenting that mode is a no-op and emits nothing.
- `enter(mode)` while presenting the *other* mode switches in place and emits
  exactly one event, not an exit followed by an enter.
- `enter('fullscreen')` from viewport mode **stays** in viewport mode when the
  request is unsupported or rejected; the one event emitted is the fallback. A
  failed switch never leaves the consumer with nothing.
- `toggle(mode)` exits whenever anything is active, whatever `mode` says. Use
  `enter(mode)` to switch modes.

Every change event carries `{ active, mode, reason, requestedMode, fallback,
fallbackCause }`. `reason` separates a normal `enter` / `exit` from `escape`
(the user dismissed viewport mode), `external-exit` (the browser ended native
fullscreen on its own), `fallback`, and `destroy`.

Viewport mode saves the element's inline `style.cssText`, appends the overlay
geometry so the consumer's own inline styles survive, sets
`data-mapkit-fullscreen="viewport"` as a styling hook, and hides document
scrolling; exiting -- or `destroy()` while presented -- restores all of it.

### The containing-block caveat

`position: fixed` is resolved against the viewport **only while no ancestor
establishes a containing block for fixed descendants**. An ancestor with
`transform`, `filter`, `backdrop-filter`, `perspective`, or `contain: paint`
becomes that containing block, and the "fullscreen" map is then trapped inside
it -- usually as a slightly larger map still sitting in its card.

The controller deliberately does **not** reparent the element to dodge this:
moving a live MapKit canvas in the DOM tears down its context and loses map
state. Apply the controller to a wrapper with no such ancestor -- normally the
wrapper holding the map *plus its own chrome*, so overlaid controls and legends
come along into fullscreen instead of being left behind.

In Nuxt, `AppMapKit` does this for you behind an opt-in prop:

```vue
<AppMapKit
  :items="stations"
  :create-pin-element="createPin"
  fullscreen-control
  fullscreen-mode="viewport"
  @fullscreen-change="onFullscreenChange"
/>
```

`fullscreenControl` defaults to `false` and `fullscreenMode` to `'viewport'`.
The component presents its own wrapper, refreshes MapKit geometry on every
change, and exposes `enterFullscreen()`, `exitFullscreen()`, and
`toggleFullscreen()` through its template ref.

## Playback

Playback helpers are plain TypeScript and do not require MapKit JS:

```ts
import {
  buildMapKitPlaybackLineSlices,
  formatMapKitPlaybackDuration,
  mapKitPlaybackProgressToIndex,
} from '@narduk-geo/narduk-mapkit/playback'

const index = mapKitPlaybackProgressToIndex(progress, route.length)
const lines = buildMapKitPlaybackLineSlices(route, index)
const label = formatMapKitPlaybackDuration(elapsedMs)
```

## Examples

The `examples/` directory contains copyable integration patterns:

- `hono-token-route.ts`
- `nuxt-mapkit-token.get.ts`
- `browser-markers.ts`
- `tile-overlay-crossfade.ts`
- `layer-registry.ts`
- `temporal-layer-controller.ts`
- `pointer-probe.ts`
- `annotation-registry.ts`
- `render-coalescing.ts`
- `fullscreen.ts`
- `pin-scaling.ts`

These are intentionally small. Keep app styling, marker HTML, and data loading
in the app.

## API Surface

| Export | Purpose |
| --- | --- |
| `@narduk-geo/narduk-mapkit/apple-maps` | Maps Server API auth exchange, access-token cache, search, and geocoding |
| `@narduk-geo/narduk-mapkit/server` | Worker-safe Fetch responses, explicit config, Worker env bridge, token cache |
| `@narduk-geo/narduk-mapkit/worker` | Explicit Worker-safe token entry point; never imports Node.js built-ins |
| `@narduk-geo/narduk-mapkit/node` | Opt-in `process.env` and Doppler CLI resolution for Node server runtimes |
| `@narduk-geo/narduk-mapkit/client` | MapKit JS loading, runtime constructors, tile overlays, layer and annotation registries, crossfades, temporal playback and its layer controller, pointer probe plumbing, render coalescing, fullscreen presentation, zoom-adaptive pin scaling |
| `@narduk-geo/narduk-mapkit/geometry` | Bounds, GeoJSON, drawable framing, distance, hit testing |
| `@narduk-geo/narduk-mapkit/playback` | Route progress, line slicing, duration formatting |
| `@narduk-geo/narduk-mapkit/token` | Low-level JWT signing and decoding |
| `@narduk-geo/narduk-mapkit-nuxt` | Nuxt module, `AppMapKit`, composables, and token route |

## Maintainer Migration Notes

The repository keeps internal migration notes under `docs/`, but those notes are
not part of the published package artifact. The short version:

1. Move token routes to `server` helpers.
2. Move local script loaders to `initializeMapKit()`.
3. Move bounds, GeoJSON, and drawable framing to `geometry` and `client`
   region helpers.
4. Move MapKit tile overlay construction and fade loops to `client` runtime
   helpers.
5. Replace template-layer MapKit components and composables with
   `@narduk-geo/narduk-mapkit-nuxt`.
6. Keep app-specific marker DOM, callouts, panels, and native Swift renderers
   outside this workspace.

## Security

Apple private keys belong only on the server side. Never pass
`APPLE_PRIVATE_KEY` or `APPLE_SECRET_KEY` to browser code.

Origin allowlists are optional for local tools, but production token endpoints
should set `allowedOrigins` or `MAPKIT_ALLOWED_ORIGINS`. Token issuance is
GET-only in the Nuxt adapter. Apps own provider-specific rate limiting and can
pass a `rateLimit` hook to the core handler or set the request-scoped Nuxt hook
documented in `packages/nuxt/README.md`.

Report vulnerabilities through the process in `SECURITY.md`, not public issues.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run quality
```

Do not add `.env` files. For local secret-backed flows, run commands through
Doppler:

```sh
doppler run -- pnpm run quality
```

`pnpm run quality` validates core and Nuxt types, tests, production builds,
`publint`, package exports, and clean-room builds installed only from packed
tarballs.

Core `dist/` remains committed for current consumers while they migrate. The
Nuxt adapter is built during `prepack`; production consumers must use published
SemVer artifacts rather than Git dependencies.

See `CONTRIBUTING.md` for public API, testing, example, and release checklist
expectations and `docs/releasing.md` for the GitHub Packages publish order and
proof.

There is no mutable `latest.tgz`, local publish poller, or absolute-path package
channel. Local tarballs are disposable test artifacts only; consumers use
immutable GitHub Packages releases with authenticated `@narduk-geo` registry
access.
