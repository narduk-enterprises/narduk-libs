# Narduk MapKit

Canonical Apple MapKit JS workspace for Narduk web apps. It publishes two
public, independently versioned packages through GitHub Packages:

- `@narduk-enterprises/narduk-mapkit` — framework-neutral client, server, token,
  geometry, temporal, vector-overlay, and Apple Maps Server API helpers, plus
  the `./nuxt` entry: a Nuxt 4 module registering `<AppMapKit>`, `useMapKit()`,
  and the same-host token route.
- `@narduk-enterprises/narduk-mapkit-nuxt` — the 2.0.x adapter, **frozen**: it
  receives no further releases (`docs/api-2.1.md` § a). It exists for apps that
  have not moved to the `./nuxt` entry. A new app uses
  `@narduk-enterprises/narduk-mapkit/nuxt` and does not install it
  (narduk-libs#696).

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
  animation frame, identical HTML writes are skipped, and focus survives a slot
  rewrite.
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
- Anchored annotation callouts as an overlay layer: single or multi open by key,
  flip/shift/clamp edge-avoidance with a caret that tracks the flip,
  camera-following through one shared animation frame, a
  `render(item, host) => cleanup` content contract with opt-in in-place updates,
  and dismissal on Escape, outside click, deselect, or pan.
- Idempotent vector-overlay attachment and bounded tile-intersection caching.
- Apple Maps access-token exchange, search, and geocoding helpers.
- A separately published Nuxt adapter with no dependency on Narduk template
  layers or UI packages.
- A deterministic, offline MapKit JS v6 fake at `/testing` for vitest and
  Playwright, with per-annotation operation counts and a loud
  `FakeMapKitNotImplemented` for anything it does not model.

## Install

Configure the scoped registry with a GitHub token that has `read:packages`:

```ini
@narduk-enterprises:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```sh
pnpm add @narduk-enterprises/narduk-mapkit
```

Nuxt apps register the package's own `./nuxt` entry; there is no second package
to install:

```ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-mapkit/nuxt'],
})
```

An app still on the frozen 2.0.x adapter
(`modules: ['@narduk-enterprises/narduk-mapkit-nuxt']`) moves by editing
`nuxt.config.ts`; no version bump hands it the new module. The two surfaces are
not identical, so check what the app uses before moving:

| Only in the frozen adapter                                              | Only in `narduk-mapkit/nuxt` |
| ----------------------------------------------------------------------- | ---------------------------- |
| `<AppMapKitCallout>`, `useMapKitCallouts` (use the `#callout` slot)     | `useMapKitFullscreen`        |
| `useMapKitVectorTiles`, `useMapkitToken`                                | `useMapKitView`              |
| `callouts*`, `fullscreenControl`, `fullscreenMode`, `centerLabel` props |                              |

The 3.0.0 plan
([`docs/plans/mapkit-consolidation-plan.md`](../../../docs/plans/mapkit-consolidation-plan.md))
names both packages, so an app on either line meets the same break.

Do not use mutable Git branches, absolute tarball paths, or vendored source in
production consumers. Publish immutable SemVer packages and pin or range those
versions normally.

## Nuxt integration

`@narduk-enterprises/narduk-mapkit/nuxt` is a Nuxt 4 module. It registers
`<AppMapKit>`, `useMapKit()`, and the same-host token route, and it has no Nuxt
UI and no color-mode-module dependency.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-mapkit/nuxt'],
  nardukMapKit: {
    libraries: ['map', 'annotations', 'overlays'],
    tokenRoute: true,
  },
})
```

| Option           | Default                              | What it does                                                       |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `component`      | `true`                               | Register `<AppMapKit>`.                                            |
| `composables`    | `true`                               | Register `useMapKit()`.                                            |
| `marks`          | `false`                              | Add the `./marks` stylesheet (`MAPKIT_MARKS_CSS`).                 |
| `libraries`      | `['map', 'annotations', 'overlays']` | App-wide default for the `libraries` prop. An empty list throws.   |
| `language`       | _unset_                              | Passed to Apple's loader.                                          |
| `rateLimit`      | _unset_ (no limit)                   | Opt-in fixed-window ceiling on the token route, per routed origin. |
| `ssrPreload`     | `true`                               | Emit `renderHTMLAttributes()` during SSR — **without** a token.    |
| `tokenRoute`     | `true`                               | Register the token route. `false` when the app serves its own.     |
| `tokenRoutePath` | `'/api/mapkit-token'`                | Relative only. An absolute or `//`-prefixed path throws at setup.  |

`libraries` is **configurable, not hard-coded**. MapKit JS 6 ships
`mapkit.core.js` as a stub, so an app that only draws annotations can drop
`'overlays'` and an app that needs `'services'` can add it. An empty list is a
configuration error rather than a silent fallback, because it would only move
the failure to the first `new mapkit.Map(...)`.

The signing material reaches the token route through `runtimeConfig`, seeded
empty by the module so the app can fill it from the environment. The environment
variable **names** are `APPLE_KEY_ID`, `APPLE_TEAM_ID`, and `APPLE_PRIVATE_KEY`
(`APPLE_SECRET_KEY` is also read); on Cloudflare the same names are read from
the Worker `env` binding. No option, log line, or `runtimeConfig.public` key
ever carries a value. Missing signing material returns `503` with
`{"error": "unconfigured"}`; a request that is not same-origin returns `403`.

### `<AppMapKit>`

> **`window.mapkit` is NOT the namespace your map belongs to.** MapKit JS 6
> resolves `mapkit.load(libraries)` to a scoped namespace object that is not
> `window.mapkit`, and an `Annotation`, `Coordinate`, `CoordinateRegion`,
> `MapRect` or `MapType` built from the global one is refused by your own map:
> `Map.addAnnotations expected an annotation at index 0, but got [object EventTarget]`.
> Build every MapKit value from the namespace the component hands you --
> `@map-ready`'s second argument, the template ref's `getMapKit()`, or
> `useMapKit().mapkit` -- and never from `globalThis.mapkit`. Measured live
> against MapKit JS 6.0.128 on 2026-09-17; the fake models the split from 2.1.1.

The component fills its parent, so the parent must establish an explicit height.

```vue
<script setup lang="ts">
const stations = ref([{ id: 'b7', label: 'Buoy 7', lat: 30.1, lng: -88.2 }])
const selectedId = ref<string | null>(null)
</script>

<template>
  <div style="height: 420px">
    <AppMapKit
      v-model:selectedId="selectedId"
      :items="stations"
      :item-key="(s) => s.id"
      :item-label="(s) => s.label"
      :pin-geometry="
        () => ({ anchor: 'bottom-center', size: { height: 36, width: 28 } })
      "
    >
      <template #callout="{ item, close }">
        <NuxtLink :to="`/stations/${item.id}`" @click="close">{{
          item.label
        }}</NuxtLink>
      </template>
    </AppMapKit>
  </div>
</template>
```

- **`itemKey`** is the buoys#112 fix. With a stable key per item, a change to
  `items` is diffed — added, moved, removed, restyled — instead of tearing every
  annotation off the map and rebuilding it. It defaults to the item's `id`.
- **`pinGeometry`** returns `{ anchor, anchorOffset, size }` per pin, replacing
  2.0.x's single global `annotationSize`. `anchor` defaults to
  `'bottom-center'`, which is what a teardrop pin wants; MapKit positions the
  element's top-left, so the library computes the offset from the size rather
  than making each app do it.
- **`#callout`** is a scoped slot (`{ close, id, item, placement, position }`)
  rendered through a `Teleport` into a host the library positions. MapKit's own
  callout can only hold DOM handed to it as an element, which is why a
  `NuxtLink` inside one never routes.
- **`retry()`** is on the exposed API, alongside `closeCallout`,
  `getDiagnostics`, `getMap`, `getMapKit`, `openCallout`, `scrollIntoView`,
  `select`, `setRegion`, and `zoomToFit`. A MapKit failure clears the cached
  initialization, so recovery is the caller's call — `#error` receives
  `{ failure, retry }`.
- **`getMapKit()`** (2.1.1) returns the scoped namespace above, or `undefined`
  before the map is ready. `@map-ready` hands over the same object as its second
  argument; the argument was added rather than replacing the payload, so every
  existing handler keeps working.
- **`pinsFocusable`** (2.1.1) defaults to `true`. Set it `false` for a map whose
  pins are a data layer the app selects from a list beside it: the hosts become
  decorative — no `role`, `tabindex`, `aria-label`, `aria-pressed`, or click /
  keyboard listeners — and `itemLabel` stops being required. A screen reader
  should not announce N buttons that do nothing.
- **`hoveredId`** (`v-model:hovered-id`, narduk-libs#517) marks the pin under
  the pointer with `data-mapkit-hovered`. Hover never adds or removes
  annotations.
- **`leader`** (`{ anchor: HTMLElement | null }`) draws a line from the selected
  pin to that element on every region change and when `items` move the
  selection. It emits `leader-offscreen` when the pin leaves the frame (not when
  the line is hidden for a missing point or anchor). The same overlay is
  `MapKitLeaderOverlay` on `./client`.
- **`mapType`** accepts Apple's `'mutedStandard'` as well as this library's
  `'muted'` from 2.1.1, and both it and `colorScheme` are now written to a live
  map when the prop changes, not only in the constructor.

#### Styling

2.1.1 ships the host chrome the component's DOM contract always implied. The
module writes one stylesheet and **unshifts** it onto `nuxt.options.css`, so it
loads before the app's own:

| Selector             | What it establishes                                          |
| -------------------- | ------------------------------------------------------------ |
| `.mapkit-wrapper`    | `position: relative`, `overflow: hidden`, `block-size: 100%` |
| `.mapkit-canvas`     | fills the wrapper — MapKit needs a sized element             |
| `.mapkit-status`     | overlays the canvas, centred, `pointer-events: none`         |
| `.mapkit-status > *` | takes pointer events back, so a retry button is clickable    |
| `.mapkit-fallback`   | fills the wrapper and scrolls — the `#fallback` slot's host  |
| `.mapkit-leader`     | SVG overlay for the selected-pin leader; no pointer events   |

It is **layout only** — no colour, font, radius, or shadow — and every selector
is a single class with no `!important`, so any rule of your own wins on source
order without needing a prefix. Set `component: false` and no stylesheet is
registered. The string is also exported as `MAPKIT_COMPONENT_CSS` from `/nuxt`
for an app that would rather inject it itself.

Three defaults flip in 2.1.0, each measured across the existing consumers:
`preserveRegion` and `suppressSelectionZoom` are now `true`, and
`showsPointsOfInterest` is now `false`.

The SSR preload is emitted **by the component** through `useHead`, not by the
module into the app head, so a page that renders no map makes no request to
`cdn.apple-mapkit.com` at all. It carries no token: a token in the tag is
MapKit's static, non-refreshable path. It is emitted during the server render
only: on the client, Apple's loader adopts the server's tag, or injects the one
tag on a client-side navigation, so a page has exactly one `mapkit.core.js`
(2.1.3, narduk-libs#469).

`@narduk-enterprises/narduk-mapkit-nuxt` stays at 2.0.x and is not part of this
release; it remains the adapter for apps that have not moved to the `./nuxt`
entry.

## Server Token Route

Mount the Fetch handler at your app's token endpoint:

```ts
import { createMapKitTokenHandler } from '@narduk-enterprises/narduk-mapkit/node'

export const GET = createMapKitTokenHandler()
```

The route is **same-host and fail-closed** (narduk-libs#421 §e): it mints a
token only for the origin that routed the request, and refuses anything that is
not same-origin. There is no origin allowlist to configure and no static-token
path — an allowlist cannot make a token work on a host Apple will reject anyway,
because Apple enforces the `origin` claim itself.

The success body is:

```json
{
  "expiresAt": 1767625200000,
  "token": "..."
}
```

`expiresAt` is the JWT `exp` in **epoch milliseconds** — `exp * 1000`, so it
compares directly against `Date.now()`. Refusals answer
`{"error": "...", "message": "..."}` — `not-same-origin` (403),
`method-not-allowed` (405, with `Allow: GET`), `rate-limited` (429, with
`Retry-After`), `unconfigured` (503), `signing-failed` (500). Every response
carries `Cache-Control: no-store` and `Vary: Origin, Sec-Fetch-Site`, and none
carries `Access-Control-Allow-Origin`. Every response also carries
`X-Content-Type-Options: nosniff`.

Behind a proxy, derive the routed origin yourself and pass it as `self` so a
forwarded host header can never reach the claim:

```ts
import { getRequestURL } from 'h3'
import {
  mapKitRoutedOrigin,
  mapKitTokenResponse,
} from '@narduk-enterprises/narduk-mapkit/server'

const self = mapKitRoutedOrigin({
  derivedOrigin: getRequestURL(event, { xForwardedHost: false }).origin,
  request: event.web?.request,
  requestTarget: event.node.req.originalUrl ?? event.path,
})
```

`mapKitRoutedOrigin` prefers the routed Fetch `Request` when the adapter has one
— on Cloudflare Workers it always does, and `request.url` there is the routed
URL — and answers `null` for an absolute-form request line, which the handler
turns into a `403` rather than a token for the host in that line. **On a Node
listener a forged `Host:` header on an ordinary request target still names the
origin claim**: nothing at this layer can tell a routed `Host` from a forged
one, so a Node deployment must refuse unknown hosts itself (a vhost filter, or a
proxy that only forwards the hostnames it serves) before this route is exposed,
or set `allowedHosts`. With `allowedHosts` set (on `MapKitServerConfig`, or the
`nardukMapKit.allowedHosts` module option), a routed host outside the list is
refused `403 not-same-origin` before the limiter and before signing. Entries are
`host[:port]`, compared case-insensitively, or `*.example.com` for any subdomain
but not the apex; an env-supplied string is read as a comma-separated list.
Unset, every routed host is accepted, which is correct on Cloudflare Workers.

The `/node` entry point is the only surface that reads `process.env` or uses the
optional Doppler CLI fallback. That fallback is legacy: Narduk's Doppler
projects are retired except the `ne` root store, so supply the values through
`process.env` (for example under `nvault run --`). Use `/server` or `/worker`
with explicit configuration in Web-standard runtimes.

### Cloudflare Workers

Workers pass secrets through `fetch(request, env)`, not `process.env`:

```ts
import { mapKitTokenResponseFromEnv } from '@narduk-enterprises/narduk-mapkit/worker'

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === '/api/mapkit-token') {
      return mapKitTokenResponseFromEnv(request, env)
    }
    return new Response('Not found', { status: 404 })
  },
}
```

Neither `mapKitTokenResponseFromEnv` nor the Nuxt module's route applies a rate
limit by default (narduk-libs#485): MapKit tokens are same-origin and
short-lived, and a default ceiling kept refusing real users. An app that wants
one opts in -- the Nuxt module through its `rateLimit` option (or a limiter
mounted on `event.context.nardukMapKit.rateLimit`, which wins), a Worker caller
by passing §e.4's limiter from the same entry point:

```ts
import {
  createMapKitFixedWindowRateLimit,
  mapKitTokenResponseFromEnv,
} from '@narduk-enterprises/narduk-mapkit/worker'

// One limiter per isolate, built once -- not per request.
const rateLimit = createMapKitFixedWindowRateLimit({
  // Default key is the routed origin, which makes the ceiling site-wide.
  key: ({ request, self }) => request.headers.get('cf-connecting-ip') ?? self,
  limit: 30,
  windowSeconds: 60,
})

mapKitTokenResponseFromEnv(request, env, {}, { rateLimit })
```

The limiter is in-process: each warm isolate keeps its own windows, so it bounds
one isolate's signing work rather than a deployment's. Put a Cloudflare rate
limiting rule or narduk-core's limiter in front of it when real abuse exposure
matters.

Narduk projects source these values from nvault (the shared signing persona is
`apple/prd/mapkit-signing`), for example:

```sh
nvault run -p apple -e prd -c mapkit-signing -- pnpm dev
```

Doppler is retired for this: do not use `doppler run`.

Cloudflare Workers should receive the same names through Worker secrets or
bindings. Recognized runtime names:

- `APPLE_PRIVATE_KEY` or `APPLE_SECRET_KEY`
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`

`MAPKIT_ALLOWED_ORIGINS`, `MAPKIT_TOKEN`, and `APPLE_MAPKIT_TOKEN` are accepted
for 2.0.x compatibility and do nothing; do not set them. In particular,
`MAPKIT_ALLOWED_ORIGINS` is not an allowlist: the route answers same-origin
requests only (`isMapKitRequestSameOrigin`), whatever the variable holds, and it
mints per routed origin. A static portal token can only ever work on one host.
When any of them is set, every `log` hook entry lists the ignored config key
(`allowedOrigins` or `staticToken`) in `deprecatedKeys`, so an app that wants a
warning reads it there.

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
} from '@narduk-enterprises/narduk-mapkit/apple-maps'

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
import { initializeMapKit } from '@narduk-enterprises/narduk-mapkit/client'

const mapkit = await initializeMapKit({
  libraries: ['map', 'annotations', 'overlays'],
  tokenEndpoint: '/api/mapkit-token',
})

const map = new mapkit.Map('map')
```

`libraries` is **required**: MapKit JS 6 loads `mapkit.core.js`, which is a stub
without them. The load goes through Apple's own `@apple/mapkit-loader`, so the
script URL and version handling belong to Apple — there is no `scriptUrl`
option, and no separate `loadMapKitLibraries()` step.

`initializeMapKit()` is a singleton: the four call sites share one load and one
token exchange. The token is delivered **only** through
`mapkit.init({ authorizationCallback })`, never as a `token` on the load call —
a token there wires MapKit's static, non-refreshable path and the map stops
working when it expires.

MapKit never re-asks for a token once an exchange fails, so a failure clears the
singleton and recovery is the caller's (`<AppMapKit>`'s `retry()`):

```ts
const mapkit = await initializeMapKit({
  libraries: ['map'],
  onConfigurationChange: (status) => {
    // 'Initialized' once, then 'Refreshed' about every 1800 s.
  },
  onFailure: (failure) => {
    // failure.status is Apple's own ConfigurationErrorStatus.
    // failure.originMismatch names the expected and actual origins.
  },
  tokenEndpoint: '/api/mapkit-token',
})
```

## Shared Region Framing

Use package geometry to keep bounds logic out of app components:

```ts
import { computeMapKitRegionForDrawables } from '@narduk-enterprises/narduk-mapkit/geometry'
import { createMapKitRegionForPoints } from '@narduk-enterprises/narduk-mapkit/client'

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
} from '@narduk-enterprises/narduk-mapkit/client'

const nextOverlay = createMapKitTileOverlay(
  window.mapkit,
  '/tiles/{z}/{x}/{y}.png',
  {
    maximumZ: 10,
    minimumZ: 3.33,
    opacity: 0,
  },
)

map.addTileOverlay(nextOverlay)

void crossfadeMapKitOverlayOpacity({
  durationMs: 520,
  nextOverlay,
  oldOverlays: [currentOverlay],
  removeOverlay: (overlay) => map.removeTileOverlay(overlay),
  targetOpacity: 0.82,
}).finished
```

## Vector Tiles

MapKit JS draws raster tiles only, so a dense vector network -- millions of line
features -- has to be painted before MapKit sees it.
`createVectorTileOverlaySource` turns an archive of vector tiles into the
`imageForTile` function the async overlay and the layer registry already accept.

The decode step is injected, for three reasons: this entry stays free of
protobuf dependencies, an app can run the decoder in a worker so the main thread
never parses a tile, and a test can paint fixture geometry without building one.

```ts
import {
  createMapKitAsyncTileOverlay,
  createPmTilesFetchSource,
  createPmTilesTileSource,
  createVectorTileOverlaySource,
} from '@narduk-enterprises/narduk-mapkit/client'
import { PMTiles } from 'pmtiles'

const archive = new PMTiles(
  createPmTilesFetchSource({
    url: 'https://data.example/river-network.pmtiles',
  }),
)
const tiles = createPmTilesTileSource({ reader: archive })

const network = createVectorTileOverlaySource({
  createCanvas: (width, height) => new OffscreenCanvas(width, height),
  decode: (bytes, tile) => decodeInWorker(bytes, tile),
  style: (properties, zoom) => {
    if (Number(properties.so) < 5 && zoom < 8) return null
    return { color: palette[status[Number(properties.ri)]], width: 1.2 }
  },
  tileBytes: (z, x, y) => tiles.getTile(z, x, y),
})

map.addTileOverlay(
  createMapKitAsyncTileOverlay(window.mapkit, network.imageForTile),
)
```

A missing tile, an empty tile, a declined style and a failed decode all resolve
to `null`, so the overlay draws nothing there rather than covering the basemap
with an empty square. Failures reach `onError` instead of rejecting.

Decoded tiles are cached, so `setStyle()` repaints from memory:

```ts
network.setStyle(nextLensStyle)
overlay.reload() // MapKit re-requests the visible tiles; no refetch, no re-decode
```

That is what makes a lens change cheap. The cache is an LRU (`cacheSize`,
default 256 tiles); `clearCache()` drops it when the archive itself changes.

`createPmTilesFetchSource` is the range-request `Source` for the `pmtiles`
reader, taking the `fetch` it uses so a test needs no network. The `pmtiles`
package is the caller's dependency, not this package's.

### Decoding a tile

The decoder itself lives in a separate entry, `./vector-tiles`, because it is
the only part of this package that depends on protobuf. `./client` -- which
every map consumer imports -- never reaches it, so an app that has no vector
layer never bundles a parser. A test walks the import graph and fails if that
line is ever crossed.

```ts
import { createMvtDecoder } from '@narduk-enterprises/narduk-mapkit/vector-tiles'

const decode = createMvtDecoder({
  layers: ['reaches'],
  properties: ['ri', 'so'], // drop `name` from the cached tiles; fetch it on click
})
```

`layers` and `properties` are worth setting on a dense archive. Geometry is
already flat buffers; properties are not, so a string on each of a few thousand
features per tile is what actually grows the cache.

Empty bytes, a tile whose layers the filter excludes, and a layer with no
features all decode to `null` -- nothing to draw, and not reported. A body that
is not a vector tile at all (an HTML error page served with a 200, a truncated
read) throws, so it reaches `onError` and gets counted rather than quietly
painting blank country over the basemap.

### Decoding off the main thread

Decoding is protobuf parsing plus a zigzag-delta walk over every point: tens of
milliseconds per tile on a national network, and MapKit asks for a screenful at
once. `serveVectorTileDecoder` hosts the decoder in a worker and
`createWorkerDecoder` talks to it, correlating replies by id so one worker
serves every tile in flight.

The worker script is the app's, not this package's -- that is the only
arrangement Vite, webpack and Nuxt all agree on:

```ts
// app/workers/river-network.ts
import {
  createMvtDecoder,
  serveVectorTileDecoder,
} from '@narduk-enterprises/narduk-mapkit/vector-tiles'

serveVectorTileDecoder(self, createMvtDecoder({ layers: ['reaches'] }))
```

```ts
// on the main thread
import { createWorkerDecoder } from '@narduk-enterprises/narduk-mapkit/client'

const decoder = createWorkerDecoder({
  worker: new Worker(new URL('./workers/river-network.ts', import.meta.url), {
    type: 'module',
  }),
})

const network = createVectorTileOverlaySource({
  decode: decoder.decode,
  ...rest,
})
```

Tile bytes are transferred to the worker and the decoded buffers transferred
back, so nothing is copied either way; pass `transfer: false` if the caller
needs to keep its own array. A worker that dies mid-decode never answers, so a
reply deadline (`timeoutMs`, default 15s) fails that one tile instead of leaving
it pending for the life of the map. `dispose()` fails everything in flight and
stops listening.

### Hit testing

A painted tile is pixels, so MapKit cannot say which river a tap landed on.
`source.hitTest()` answers that from the decoded tiles the cache already holds:
it projects the coordinate into tile space, walks the geometry, and returns the
nearest feature within the tolerance, with the properties that came out of the
archive.

```ts
map.addEventListener('single-tap', (event) => {
  const point = map.convertPointOnPageToCoordinate(event.pointOnPage)
  const hit = network.hitTest({
    coordinate: { latitude: point.latitude, longitude: point.longitude },
    zoom: Math.round(zoomForRegion(map.region)),
  })
  if (hit) selectReach(hit.properties.ri, hit.distancePx)
})
```

It is synchronous and never fetches. A tap has to be answered in the gesture,
and the only tiles that can be searched in that time are the ones already
decoded -- which, for a tap on a river the user can see, is exactly the tile
under their finger. A tap on an undrawn tile misses.

`tolerancePx` is a screen radius, not a tile distance: the default of 8px is
about a fingertip, and the returned `distancePx` is in the same units, so a
caller can prefer a closer feature across two sources. Distance is measured to
the nearest point on a segment rather than to a vertex, so a tap in the middle
of a long straight reach hits it.

The probe also reaches into neighbouring tiles when it falls within the
tolerance of an edge, wrapping at the antimeridian and stopping at the poles.
Without that, a river drawn a pixel inside the next tile would be untappable
along every tile boundary on the map -- a grid of dead lines the user cannot
see.

### What a decoded tile costs

A decoded tile is columnar: one `Int16Array` of interleaved `x, y` pairs, plus
two `Uint32Array` indexes describing where each feature and line begins.

That is not a micro-optimisation. A tile of flowlines carries on the order of
10^5 points; one `{ x, y }` object per point costs roughly 40 bytes once V8 has
its header and pointer, so the default 256-tile cache would retain about a
gigabyte -- past what mobile Safari gives a tab before discarding it. The same
points cost 4 bytes each here.

`source.cacheBytes` reports what the cache is holding, so an app can set
`cacheSize` against a real budget rather than a guess. Geometry and indexes are
exact; properties are estimated, since only the engine knows an object's real
footprint -- but they are counted, because a `name` string on each of a few
thousand features per tile is the part that actually grows a dense archive.
Build a tile by hand with `buildDecodedVectorTile`, read one back with
`vectorTileFeatureCount` and the index arrays, and measure one with
`decodedVectorTileBytes`.

Requests for an address already in flight join that read rather than starting a
second one -- MapKit re-asks for the same tile on every render pass, so without
that the archive is fetched twice and the tile decoded twice for one tile drawn.
`clearCache()` also discards whatever is in the air, so a read started against
the archive being replaced cannot land in the cleared cache.

## Layer Registry

Use the layer registry when a map needs multiple raster layers live at the same
time, each with its own opacity and AOI bounds:

```ts
import {
  MapKitLayerRegistry,
  regionForMapKitLayer,
} from '@narduk-enterprises/narduk-mapkit/client'

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

MapKit JS 6 consumers can register authenticated or cache-backed image providers
directly. Waiting for the first usable image is bounded, so a provider that
never signals readiness cannot leave the previous layer visible forever:

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

When `bounds` are present, tile URLs outside the layer extent resolve to a valid
1x1 transparent PNG data URI before any network request. `replace()` requires an
already-registered id and folds any still-fading overlays for that id into the
next crossfade. Async replacements may activate immediately or on their first
image, with a bounded timeout that guarantees stale overlays are retired.
`unregister()` is a no-op for unknown ids.

## Annotation Registry

`MapKitAnnotationRegistry` is the marker-side sibling of the layer registry.
MapKit JS does no diffing, so the obvious update is `map.removeAnnotations(all)`
followed by `map.addAnnotations(next)` -- which destroys and rebuilds every
marker on every render and makes them blink. Reconcile by key instead:

```ts
import { MapKitAnnotationRegistry } from '@narduk-enterprises/narduk-mapkit/client'

const annotations = new MapKitAnnotationRegistry<mapkit.MarkerAnnotation>({
  map,
})

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

| Key                      | Signature | Result                                                     |
| ------------------------ | --------- | ---------------------------------------------------------- |
| present before and after | unchanged | untouched -- no remove, no re-add, no mutation             |
| present before and after | changed   | `update()` in place, or recreate that key alone if no hook |
| absent now               | --        | removed                                                    |
| new                      | --        | created                                                    |

Removals batch into one `removeAnnotations` call and additions into one
`addAnnotations` call; an empty set makes no call at all, so reconciling the
same descriptors twice is a complete no-op. `reconcile()` returns
`{ added, recreated, removed, unchanged, updated }`, which is the cheapest way
to assert in a test that a pan or an opacity tick touched nothing.

The `signature` is the finer-grained analogue of `layerSourceIdentity()`: the
layer registry fingerprints a whole tile source and treats any change other than
opacity as a full replace, while a signature is whatever string the consumer
decides distinguishes one rendering of a marker from another, so a change can be
applied in place.

`register()` / `unregister()` handle one annotation outside a reconcile pass,
`get()` / `has()` / `list()` / `size` inspect the live set, and `destroy()`
clears every annotation and makes the registry inert.

## Pin Scaling

`MapKitPinScalingController` is the presentation-side sibling of the annotation
registry. The registry owns _which_ annotations exist; this owns what they look
like at the current zoom -- size, dot-versus-symbol, and rank culling -- over
the registry's live annotations, by key.

The usual implementation of this rewrites every marker's `innerHTML` and
`cssText` on `region-change-end`. With a few thousand pins that is a few
thousand subtree rebuilds per gesture, and because it can only run at the _end_
of a gesture the markers pop rather than scale. This splits the problem:

- **Continuous.** Size between thresholds is one number, published as CSS custom
  properties on a single container element. A zoom gesture costs two property
  writes per frame for _any_ number of pins -- no element is created, destroyed,
  or rewritten.
- **Structural.** Dot mode and culling change only at thresholds, and they
  depend on `(class, zoom)` rather than on the individual pin. So the latched
  state lives per class, a frame costs O(classes), and only a class that
  actually crossed touches its members. `changed` names exactly those keys.

```ts
import {
  createMapKitPinScalingController,
  mapKitZoomForSpan,
} from '@narduk-enterprises/narduk-mapkit/client'

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
    for (const key of event.changed)
      paintPin(key, scaling.presentationFor(key)!)
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

So smooth scaling _during_ a pinch is only possible by reading the camera once
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
this problem -- _"if there's a dense cluster of annotations at low zoom levels,
it's good practice to hide some annotations"_ -- and, unlike
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
applied to the _question_: a visible pin is asked whether it survives slightly
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
scoped `--mapkit-pin-size-<class>` / `--mapkit-pin-scale-<class>` pair beside
the base ones.

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
} from '@narduk-enterprises/narduk-mapkit/client'

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

`createTemporalLayerController` binds those primitives to one registry layer. It
owns index state, readiness bookkeeping, bounded prefetch, and a readiness-gated
loop; the app owns the date strip, the play button, and the descriptor for each
date:

```ts
import { createTemporalLayerController } from '@narduk-enterprises/narduk-mapkit/client'

const controller = createTemporalLayerController({
  registry,
  layerId: 'data',
  frames: [
    '2026-08-24',
    { id: '2026-08-25', meta: { observedFraction: 0.62 } },
  ],
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
- `descriptorForFrame` must return a descriptor whose `id` equals `layerId`. The
  controller throws rather than letting the registry reject the swap
  mid-animation.

## Point-Map Marks

`@narduk-enterprises/narduk-mapkit/marks` is the kit a map-first app draws its
points with. It was lifted unchanged from buoys (narduk-libs#517), which is the
reference consumer. Nothing in it knows about Vue, Nuxt, or any domain: the
caller supplies projected pixel positions, radii, colours, and every word of
copy, and reads back layout.

| Module      | What it does                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `declutter` | `declutter()` places same-layer circles largest-first on a uniform spatial grid and folds anything a placed circle overlaps into its `absorbed` list; a primary layer absorbs an overlapping secondary layer; background context marks are thinned clear. Deterministic: exact ties break by ascending id. `pickPeaks()` and `majority()` pick what a crowded cell shows. |
| `labels`    | `placeLabels()` places name pills beside placed discs without collisions.                                                                                                                                                                                                                                                                                                 |
| `layer`     | `createMarkLayer(map, runtime)` reconciles a keyed list of `MarkSpec`s onto MapKit annotations through `MapKitAnnotationRegistry`.                                                                                                                                                                                                                                        |
| `marks`     | `createPinMark()`, `createSelectedMark()`, `createBackgroundMark()` build the annotation DOM: a zero-size anchor with a sized disc, optional glyph, stack rim, and name pill.                                                                                                                                                                                             |
| `camera`    | `projectToFrame()`, `frameToCoordinate()`, `padRect()`/`unpadRect()`, `rectForBox()`, `rectRevealing()`, `zoomRect()`, and `tierForSpan()` for map-rect math against the visible frame.                                                                                                                                                                                   |
| `overflow`  | `overflowEdges()` reports which frame edges hidden marks lie beyond.                                                                                                                                                                                                                                                                                                      |
| `overview`  | `mapOverviewCamera()` frames the interquartile core of a point set and falls back to `NORTH_AMERICA_OVERVIEW` when the core spans more than a third of the planet.                                                                                                                                                                                                        |
| `runtime`   | Structural `Mk*` types plus `asMkMap()` and `asMkRuntime()` to narrow what `<AppMapKit>` hands over. Pass the scoped namespace from `useMapKit().mapkit.value`, never `window.mapkit` (K-10).                                                                                                                                                                             |

Style the marks with the module's `marks: true` option in Nuxt, or put
`MAPKIT_MARKS_CSS` on the page yourself. Every rule reads a `--mk-*` custom
property (`--mk-ink`, `--mk-ink-2`, `--mk-ink-3`, `--mk-void`, `--mk-surface`,
`--mk-focus`, `--mk-font-sans`, `--mk-font-mono`, `--mk-leader`) with a neutral
fallback, so a host themes marks by setting those on any ancestor of the map.

### `useMapKitView()` in Nuxt

`useMapKitView()` is the Vue side of the marks: it owns the map behind a
map-first page's `<AppMapKit>` (camera, frame, zoom tier, padding, basemap, the
mark layer and fullscreen). It is auto-imported with `useMapKit()` under the
module's `composables` option, and was lifted from buoys along with `./marks`.

```vue
<script setup lang="ts">
const surface = useTemplateRef<HTMLElement>('surface')
const view = useMapKitView({
  basemap: () => 'MutedStandard',
  insets: () => ({ top: 24, right: 416, bottom: 24, left: 24 }), // chrome over the map
  padding: () => ({ top: 0, right: 0, bottom: 0, left: 0 }), // where Apple's logo sits
  specs: () => markSpecs.value, // MarkSpec[] built with createPinMark()
  surface: () => surface.value,
})
</script>

<template>
  <div ref="surface">
    <AppMapKit :items="[]" @map-ready="view.onMapReady" />
  </div>
</template>
```

- **`items` stays empty.** The view draws through `createMarkLayer()`, so the
  component's own pin layer has nothing to diff.
- **The runtime comes from `map-ready`'s second argument**, the scoped namespace
  (K-10), never `window.mapkit`.
- **`mapReady` waits for a laid-out host.** MapKit can fire `map-ready` before
  its element has a size; the view retries across frames, then re-applies the
  region so custom annotations line up with the canvas.
- **Built-in controls are off.** The page draws its own zoom, layers and scale.
- **Camera moves are whole-frame.** `fitBox()`, `reveal()` and `zoomBy()` keep
  targets clear of `insets`, and changing `padding` holds the camera still.
- `useMapKitFullscreen({ surface, onLayout })` is the same fullscreen toggle as
  a standalone composable.

Both are also exported from `@narduk-enterprises/narduk-mapkit/nuxt/composables`
for callers auto-import never reaches -- a unit test under plain vitest, an app
with `imports.autoImport` off, or any module that wants the function rather than
the ambient name:

```ts
import {
  useMapKitFullscreen,
  useMapKitView,
} from '@narduk-enterprises/narduk-mapkit/nuxt/composables'
```

`useMapKit()` is not on that subpath. It reads the module's runtime options
through `#imports`, which only resolves inside a Nuxt build; these two need only
Vue, because the view takes its MapKit namespace from `map-ready` (K-10) rather
than from the kit handle.

## Pointer Probe

`attachMapKitPointerProbe` is the pointer plumbing behind a map readout. One
recognizer covers desktop hover, click-to-pin, touch tap-to-pin,
long-press-to-pin, pin dragging, and dismissal, and separates all of them from a
map pan by movement slop and press duration:

```ts
import { attachMapKitPointerProbe } from '@narduk-enterprises/narduk-mapkit/client'

const probe = attachMapKitPointerProbe({
  element: mapElement,
  coordinateForPoint: (sample) =>
    map.convertPointOnPageToCoordinate(
      new DOMPoint(sample.page.x, sample.page.y),
    ),
  hoverThrottleMs: 90,
  longPressDurationMs: 500,
  moveSlopPx: 8,
  isPinHandle: (target) =>
    target instanceof Element && target.closest('.probe-pin') !== null,
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
- **Touch never hovers.** `hoverPointerTypes` defaults to `['mouse', 'pen']` and
  `longPressPointerTypes` to `['touch', 'pen']`.
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
import { createMapKitRenderScheduler } from '@narduk-enterprises/narduk-mapkit/client'

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

`region` is a caller-defined string this package never interprets, so a consumer
can redraw only what changed. Marking from inside `onFlush` schedules a
follow-up frame rather than recursing. Animation frames are injectable, so the
scheduler is deterministic under test and safe to import where
`requestAnimationFrame` does not exist.

`createMapKitHtmlSlotRenderer()` drops the DOM write when the markup did not
change -- assigning `innerHTML` rebuilds the subtree even when the string is
identical, which is what makes a re-rendered readout blink:

```ts
import {
  createMapKitFocusPreserver,
  createMapKitHtmlSlotRenderer,
} from '@narduk-enterprises/narduk-mapkit/client'

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
  resolve: (key) =>
    panel.querySelector<HTMLElement>(`[data-focus-key="${key}"]`),
})

focus.preserve(() => slots.write(panel, panelHtml))
```

`preserve()` restores even when the write throws, and `capture()` / `restore()`
are available separately for a batch spanning several calls. Selection access is
guarded, because reading `selectionStart` throws on input types that do not
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
} from '@narduk-enterprises/narduk-mapkit/client'

const fullscreen = createMapKitFullscreenController({
  element: mapWrapper,
  // Runs after every geometry change, before the subscribers.
  onLayout: () => refreshMapKitMapLayout(map),
})

fullscreen.subscribe((event) => {
  button.setAttribute('aria-pressed', String(event.active))
  if (event.fallback)
    console.info('native fullscreen unavailable:', event.fallbackCause)
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
- `enter(mode)` while presenting the _other_ mode switches in place and emits
  exactly one event, not an exit followed by an enter.
- `enter('fullscreen')` from viewport mode **stays** in viewport mode when the
  request is unsupported or rejected; the one event emitted is the fallback. A
  failed switch never leaves the consumer with nothing.
- `toggle(mode)` exits whenever anything is active, whatever `mode` says. Use
  `enter(mode)` to switch modes.

Every change event carries
`{ active, mode, reason, requestedMode, fallback, fallbackCause }`. `reason`
separates a normal `enter` / `exit` from `escape` (the user dismissed viewport
mode), `external-exit` (the browser ended native fullscreen on its own),
`fallback`, and `destroy`.

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
wrapper holding the map _plus its own chrome_, so overlaid controls and legends
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

## Reveal beside and the leader overlay

`rectBeside(rect, frame, point, anchor, options)` is pure camera math on
`./client`, next to `refreshMapKitMapLayout`. It returns the visible map rect
that places a coordinate beside a DOM rect: a gap (default 24px), a vertical
target (default the rect's centre), and one extra zoom step when
`clustered: true`. Frame and anchor are in the map's CSS pixels; `point` is the
coordinate's current position in that same frame.

```ts
import { rectBeside } from '@narduk-enterprises/narduk-mapkit/client'

const next = rectBeside(map.visibleMapRect, frame, pinPoint, cardRect, {
  clustered: pin.memberCount > 1,
  gap: 24,
  verticalTarget: cardRect.y + 48,
})
map.setVisibleMapRectAnimated(
  new mapkit.MapRect(
    next.origin.x,
    next.origin.y,
    next.size.width,
    next.size.height,
  ),
  true,
)
```

`MapKitLeaderOverlay` draws the line from that pin to the card (or a notch /
caret element) and reports when the pin is off screen. `<AppMapKit>` accepts the
same overlay as the `leader` prop.

## Callouts

`createMapKitCalloutController()` anchors app-owned content to map coordinates.
It is an overlay layer rather than MapKit's own callout delegate, and it owns
open/close/toggle by key, placement, edge-avoidance, following the camera, and
dismissal -- never what a callout looks like.

```ts
import { createMapKitCalloutController } from '@narduk-enterprises/narduk-mapkit/client'

const callouts = createMapKitCalloutController<Station, Station>({
  // A positioned element. Use the wrapper holding the map plus its chrome.
  container: mapWrapper,
  // Subscribing to the map is what makes callouts follow a pan or a zoom.
  map,
  mode: 'single',
  projectCoordinate: (station) =>
    map.convertCoordinateToPointOnPage(
      new mapkit.Coordinate(station.lat, station.lng),
    ),
  render: (context, host) => {
    const node = renderStationCard(context.item, context.close)
    host.append(node)
    // Always runs: on close, on a re-open without `update`, and on destroy().
    return () => node.remove()
  },
})

callouts.open({ coordinate: station, item: station, key: station.id })
```

### Why an overlay and not the callout delegate

MapKit JS has a native hook -- `calloutEnabled` plus a `callout` delegate with
`calloutElementForAnnotation()` and `calloutAnchorOffsetForAnnotation()`. It is
the right answer for a static bubble of text, and it was rejected here for four
reasons, worst first:

1. **MapKit owns the element's lifetime and never says when it ends.** The
   delegate is asked for an element each time the callout appears, and the
   element is discarded on dismissal with no teardown callback and no update
   hook. A framework subtree mounted into it -- a Vue Teleport, a React portal
   -- is orphaned rather than unmounted, and its effects and listeners leak.
2. **One callout, ever.** A native callout belongs to `map.selectedAnnotation`
   and MapKit permits one selection, so comparing two markers side by side is
   not expressible.
3. **The anchor offset is computed once and never revisited**, so there is no
   edge-avoidance: a marker near the top of the map gets a callout clipped by
   the map's bounds instead of flipped below the pin.
4. **It needs the `mapkit` global**, which this framework-agnostic, Worker-safe
   core deliberately does not import.

The cost is that positioning is ours. It is paid once per frame: a flush
projects and measures every open callout before writing any of them, so N open
callouts cost one forced layout, and a camera movement drives them all from one
`requestAnimationFrame` loop rather than a listener per callout.

### Placement

`layoutMapKitCallout()` is exported on its own -- it is pure, and it is where
the three corrections happen, each reported separately:

- **flip** (main axis): `'above'` becomes `'below'` when the preferred side
  cannot hold the box and the opposite side has more room. The caret moves to
  the other edge with it.
- **shift** (cross axis): the box slides to stay `edgePadding` clear of both
  edges, and the caret slides the other way so it keeps pointing at the anchor,
  stopping `caretSize` short of a corner.
- **clamp** (both axes, last resort): a box larger than the container is pinned
  inside it rather than allowed to overflow.

An anchor that projects outside the container hides its callout instead of
closing it, so panning a marker off-screen and back does not destroy the
content. The layer is `pointer-events: none` and each callout re-enables its
own, so the map stays draggable between them.

### Content lifecycle

`render(context, host)` mounts and returns the teardown. Re-opening an open key
calls `update(context, host)` when one is supplied -- the mounted content and
its cleanup survive -- and otherwise tears the content down and renders it
again. `close()`, `closeAll()`, and `destroy()` all run the cleanup.

Dismissal is a set of options: `closeOnEscape` and `closeOnMapClick` default on,
`closeOnDeselect` closes on the map's `deselect` event (narrowed to one callout
when `keyForAnnotation` is supplied), and `closeOnPan` is off because the
default behaviour is to follow the camera instead. `focusOnOpen` moves focus
into the callout and `restoreFocus` returns it on close.

Every event carries `{ item, key, phase, reason }`, where `phase` is `'open'`,
`'update'`, or `'close'` and `reason` separates `'api'`, `'toggle'`, `'escape'`,
`'map-click'`, `'deselect'`, `'pan'`, `'replaced'`, and `'destroy'`.

### In Nuxt

`AppMapKit` wires the controller behind an opt-in prop, and `AppMapKitCallout`
turns a Vue slot into the callout's contents:

```vue
<AppMapKit v-model:selected-id="selectedId" :items="stations" callouts>
  <AppMapKitCallout :items="stations" v-slot="{ item, close }">
    <UCard>
      <template #header>{{ item.name }}</template>
      {{ item.reading }}
      <UButton @click="close">Close</UButton>
    </UCard>
  </AppMapKitCallout>
</AppMapKit>
```

`callouts` defaults to `false`. The slot content is teleported into the
controller-owned host, so it stays inside the page's own Vue tree: reactivity,
`provide`/`inject`, `useNuxtApp()`, and Nuxt UI's app config all reach it. See
the Nuxt adapter's README for the props, events, and exposed methods.

## Playback

Playback helpers are plain TypeScript and do not require MapKit JS:

```ts
import {
  buildMapKitPlaybackLineSlices,
  formatMapKitPlaybackDuration,
  mapKitPlaybackProgressToIndex,
} from '@narduk-enterprises/narduk-mapkit/playback'

const index = mapKitPlaybackProgressToIndex(progress, route.length)
const lines = buildMapKitPlaybackLineSlices(route, index)
const label = formatMapKitPlaybackDuration(elapsedMs)
```

## Testing: the MapKit fake

`@narduk-enterprises/narduk-mapkit/testing` is a deterministic, offline fake of
MapKit JS v6. It exists so a component test can assert what the map was _told_
to do without a network, an Apple key, or a real canvas. It is a dev-time export
only: no production entry point can reach it, and it adds no runtime dependency.

Its behaviour is modelled on a measured spike against real MapKit JS 6.0.128 on
2026-09-17, not on the documentation alone. Where the two disagree, the
measurement wins and the option's doc comment says which is which.

**The fidelity rule.** Reading or writing any member the fake does not model
throws `FakeMapKitNotImplemented: <member>` instead of answering `undefined`. A
fake that silently no-ops is how a test goes green for code that would fail
against Apple, so the fake is loud by construction. If you hit that error and
the member matters, model it here rather than working around it in the app.

The same rule covers a member the fake **does** model but nothing has set:
reading `map.mapType` on a map built without one throws, because Apple documents
no default and a guess is how a fake teaches a test the wrong thing. Where real
MapKit's behaviour is genuinely unknown the fake records instead of inventing --
see `degenerateCameraInputs` below.

**The scoped namespace (2.1.1).** `handle.mapkit` is the namespace `install()`
publishes as `globalThis.mapkit`; `handle.load()` resolves to a **different**
one, exactly as MapKit JS 6 does. Each namespace's `maps` lists only its own,
and a map refuses an annotation, region or `MapRect` built from the other with
Apple's own message. Drive the component through `load()` -- as production does
-- and build the values you hand it from what `load()` resolved, not from
`handle.mapkit`. 2.1.0's fake returned one object for both, which is how 62
green end-to-end tests shipped a blank map.

**`init()` is a page singleton (K-7).** A second `mapkit.init()` after a
_failed_ token exchange runs a new exchange, which is how `<AppMapKit>`'s
`retry()` is tested. Any other second call -- while the first exchange is
pending, or after it succeeded -- is an idempotent no-op: no new token is
requested, the first call's options stand, and the call is logged as `init` with
detail `ignored`. A page that mounts several maps therefore needs no double-init
shim (narduk-libs#522).

**The rect camera (K-5).** `map.visibleMapRect`,
`map.setVisibleMapRectAnimated()`, `mapkit.MapRect` / `MapPoint` / `MapSize` and
`mapkit.Map.MapTypes` are modelled alongside the region camera. The rect is the
Web-Mercator unit rect of the region the fake projects pins with, so a
coordinate lands on the same pixel whichever camera a page drives.

### In vitest (happy-dom or jsdom)

```ts
// @vitest-environment happy-dom
import { installFakeMapKit } from '@narduk-enterprises/narduk-mapkit/testing'

// Publishes `globalThis.mapkit`, so code under test sees the real global name.
const fake = installFakeMapKit({ auth: { mode: 'accept' } })
fake.mapkit.init({ authorizationCallback: (done) => done('test.token') })

// The namespace a real app gets back. NOT `fake.mapkit` -- see above.
const mapkit = await fake.load({ libraries: ['map', 'annotations'] })

const host = document.body.appendChild(document.createElement('div'))
const map = new mapkit.Map(host)
map.addAnnotation(
  new mapkit.MarkerAnnotation(new mapkit.Coordinate(30.2, -88.1), {
    title: 'Buoy',
  }),
)

expect(fake.inspect.annotationsAdded).toBe(1)
fake.uninstall()
```

Handing that map a `new fake.mapkit.MarkerAnnotation(...)` instead throws
`Map.addAnnotations expected an annotation at index 0, but got [object EventTarget]`
-- the real message, from the real defect.

### In Playwright

```ts
import { fakeMapKitInitScript } from '@narduk-enterprises/narduk-mapkit/testing'

await page.addInitScript({
  content: fakeMapKitInitScript({ auth: { mode: 'accept' } }),
})
await page.goto('/map')
await expect(page.locator('.mk-annotation')).toHaveCount(3)

// `__fakeMapKit` is the runtime; its `inspect` surface is readable from the page.
const added = await page.evaluate(
  () => (window as any).__fakeMapKit.inspect.annotationsAdded,
)
expect(added).toBe(3)
```

The whole fake is one self-contained function with type-only imports, so
`fakeMapKitInitScript()` serialises it with `toString()`: no bundler, and no
second implementation to keep in sync. `tests/testing/init-script.test.ts`
evaluates the generated source in an isolated realm so a stray free variable
fails at `pnpm test`, not in a browser run.

### The inspection API

`fake.inspect` is deliberately separate from the Apple-shaped surface, so no
production code can reach for it by accident.

| Member                             | Answers                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `operations`                       | Every observed call, oldest first, with arguments summarised                 |
| `count(name)`                      | Calls of one operation -- calls, not annotation instances                    |
| `annotationsAdded` / `Removed`     | Annotation instances passed to the add/remove methods, cumulative            |
| `annotationCounts(idOrAnnotation)` | Per-annotation add/remove/mutation counts                                    |
| `selectAnnotation(map, a)`         | Simulate a user selecting a pin: fires `deselect`, `select`, renders callout |
| `calloutElement(a)`                | The rendered callout element, or `null`                                      |
| `tokens` / `tokenCalls`            | Tokens passed to `done()`, and how often the callback ran                    |
| `bootstrapAttempts`                | Every bootstrap attempt, with the token index it used                        |
| `configurationChanges` / `errors`  | Statuses dispatched, oldest first                                            |
| `advanceClock(ms)` / `now`         | The fake access-key clock. No real timer is ever involved                    |
| `degenerateCameraInputs`           | Rect/padding camera writes with no positive extent or no room left           |

The per-annotation counts are the point. They let a test assert a budget rather
than an outcome -- "updating 1 of 600 pins touched 1 annotation, not 600" is a
regression test for the reconciliation defect the annotation registry exists to
prevent, and it is not expressible against a fake that only reports final state.

`degenerateCameraInputs` (2.1.1) exists for the same reason in the other
direction. A `MapRect` with a non-positive `width`/`height`, or `padding` whose
insets leave no room in the container, is an input Apple documents no behaviour
for. Buoys saw a real map zoom out to a continent on the phone when its
selection maths produced one, but one observation of one input is not a rule --
so the fake **applies the write and records it** rather than clamping, throwing,
or pretending to know. `expect(fake.inspect.degenerateCameraInputs).toEqual([])`
is the assertion that would have caught it.

### Scriptable authorization

`auth.mode` picks the outcome:

- `'accept'` -- one bootstrap attempt, then `configuration-change` with
  `status: 'Initialized'`.
- `'wrong-origin'` -- the measured origin-mismatch shape: MapKit retries the
  **same** token three times, invokes `authorizationCallback` exactly **once**,
  then fails `Unauthorized` with Apple's
  `Origin does not match - expected: ..., actual: ...` message. MapKit does not
  ask for a fresh token when Apple rejects the one it has; recovery is the
  application's job, and this mode is how you test that it happens.
- `'error'` -- any `ConfigurationErrorStatus` via `auth.status`, using Apple's
  seven values verbatim.

### The access-key clock is injected, and its default is UNVERIFIED

Apple issued an access key valid for 1800 s from bootstrap on all 11 measured
runs, independent of the JWT's own `exp`. What MapKit does at that boundary was
**not** established: the 31-minute observation run was cut short. So the clock
is yours to drive -- `fake.inspect.advanceClock(1_800_001)` -- and
`auth.onAccessKeyExpiry` chooses what crossing it does:

| Value       | Behaviour                                                      |
| ----------- | -------------------------------------------------------------- |
| `'refresh'` | Default. Calls `authorizationCallback` again, then `Refreshed` |
| `'nothing'` | The key lapses silently                                        |
| `'error'`   | Dispatches `error` with `auth.status`                          |

`'refresh'` follows Apple's documented contract, but it is a documented
expectation and not a measurement. **If your code's correctness depends on which
of these really happens, write the test for both `'refresh'` and `'nothing'`**
rather than trusting the default.

### What the fake does not model

Overlays (`TileOverlay`, `ImageOverlay`, `Polyline`, `PolygonOverlay`),
`mapkit.Search` and `mapkit.Geocoder`, user location, directions, real map
tiles, and real animation timing. Every one of them throws
`FakeMapKitNotImplemented` on touch. The fake covers what this library's own
registries and the Narduk map component need; the admission bar for adding to it
is two live applications or a defect fix.

It also does not model per-namespace class identity. Foreign values are refused
by a brand check, so a cross-namespace `instanceof` still passes in the fake
where real MapKit's would fail. Nothing in this library branches on
`instanceof`; a consumer that does is outside what the fake covers.

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
- `annotation-callouts.ts`
- `vector-tile-network.ts`

These are intentionally small. Keep app styling, marker HTML, and data loading
in the app.

## API Surface

| Export                                               | Purpose                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@narduk-enterprises/narduk-mapkit/apple-maps`       | Maps Server API auth exchange, access-token cache, search, and geocoding                                                                                                                                                                                                                        |
| `@narduk-enterprises/narduk-mapkit/server`           | Worker-safe Fetch responses, explicit config, Worker env bridge, token cache                                                                                                                                                                                                                    |
| `@narduk-enterprises/narduk-mapkit/worker`           | Explicit Worker-safe token entry point; never imports Node.js built-ins                                                                                                                                                                                                                         |
| `@narduk-enterprises/narduk-mapkit/node`             | Opt-in `process.env` and Doppler CLI resolution for Node server runtimes                                                                                                                                                                                                                        |
| `@narduk-enterprises/narduk-mapkit/client`           | MapKit JS loading, runtime constructors, tile overlays, layer and annotation registries, crossfades, temporal playback and its layer controller, pointer probe plumbing, render coalescing, fullscreen presentation, anchored callouts, zoom-adaptive pin scaling, `rectBeside`, leader overlay |
| `@narduk-enterprises/narduk-mapkit/geometry`         | Bounds, GeoJSON, drawable framing, distance, hit testing                                                                                                                                                                                                                                        |
| `@narduk-enterprises/narduk-mapkit/marks`            | Framework-free point-map marks: declutter engine, label placement, keyed mark layer, DOM pin builders and their stylesheet, frame/camera math, overview framing                                                                                                                                 |
| `@narduk-enterprises/narduk-mapkit/playback`         | Route progress, line slicing, duration formatting                                                                                                                                                                                                                                               |
| `@narduk-enterprises/narduk-mapkit/testing`          | Dev-only deterministic MapKit JS v6 fake, operation log, and Playwright init script                                                                                                                                                                                                             |
| `@narduk-enterprises/narduk-mapkit/token`            | Low-level JWT signing and decoding                                                                                                                                                                                                                                                              |
| `@narduk-enterprises/narduk-mapkit-nuxt`             | Nuxt module, `AppMapKit`, `AppMapKitCallout`, composables, and token route                                                                                                                                                                                                                      |
| `@narduk-enterprises/narduk-mapkit/nuxt/composables` | `useMapKitView()` and `useMapKitFullscreen()` as explicit imports, for callers outside Nuxt auto-import                                                                                                                                                                                         |

## Maintainer Migration Notes

The repository keeps internal migration notes under `docs/`, but those notes are
not part of the published package artifact. The short version:

1. Move token routes to `server` helpers. Drop `MAPKIT_ALLOWED_ORIGINS`,
   `MAPKIT_TOKEN` and `APPLE_MAPKIT_TOKEN`: 2.1+ accepts and ignores them, and
   the route is same-origin-only regardless of any allowlist.
2. Move local script loaders to `initializeMapKit()` and pass `libraries`.
3. Move bounds, GeoJSON, and drawable framing to `geometry` and `client` region
   helpers.
4. Move MapKit tile overlay construction and fade loops to `client` runtime
   helpers.
5. Replace template-layer MapKit components and composables with
   `@narduk-enterprises/narduk-mapkit-nuxt`.
6. Keep app-specific marker DOM, callout _contents_, panels, and native Swift
   renderers outside this workspace. Callout anchoring, edge-avoidance, and
   lifecycle are the package's job; what a callout looks like is the app's.

## Security

Apple private keys belong only on the server side. Never pass
`APPLE_PRIVATE_KEY` or `APPLE_SECRET_KEY` to browser code.

The token route is same-host: it mints only for the origin that routed the
request, and never trusts `Origin`, `Referer`, or an `X-Forwarded-*` header as
the source of truth for that origin. `allowedOrigins` and
`MAPKIT_ALLOWED_ORIGINS` are accepted for 2.0.x compatibility and ignored; the
route logs their presence as deprecated. Token issuance is GET-only. Apps own
provider-specific rate limiting and pass a `rateLimit` hook to the handler — the
hook is part of the handler, not a path-matched middleware, so no URL spelling
can route around it. `createMapKitFixedWindowRateLimit` (exported from `/server`
and `/worker`) is the in-process limiter the Nuxt module applies when an app
sets its `rateLimit` option; with the option unset the route has no limit.

Report vulnerabilities through the process in `SECURITY.md`, not public issues.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run quality
```

Do not add `.env` files. For local secret-backed flows, run commands through
nvault (Doppler is retired except the `ne` root store):

```sh
nvault run -p apple -e prd -c mapkit-signing -- pnpm run quality
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
immutable GitHub Packages releases with authenticated `@narduk-enterprises`
registry access.
