# Narduk MapKit

Canonical Apple MapKit JS workspace for Narduk web apps. It publishes two
public, independently versioned npm packages:

- `@loganrenz/narduk-mapkit` — framework-neutral client, server, token,
  geometry, temporal, vector-overlay, and Apple Maps Server API helpers.
- `@loganrenz/narduk-mapkit-nuxt` — `AppMapKit`, `useMapKit`,
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
- A MapKit JS layer registry for multiple live AOI tile overlays with
  independent opacity, bounds-gated tile URLs, and replacement fades.
- Idempotent vector-overlay attachment and bounded tile-intersection caching.
- Apple Maps access-token exchange, search, and geocoding helpers.
- A separately published Nuxt adapter with no dependency on Narduk template
  layers or UI packages.

## Install

```sh
pnpm add @loganrenz/narduk-mapkit
```

Nuxt apps install both immutable releases:

```sh
pnpm add @loganrenz/narduk-mapkit @loganrenz/narduk-mapkit-nuxt
```

```ts
export default defineNuxtConfig({
  modules: ['@loganrenz/narduk-mapkit-nuxt'],
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
import { createMapKitTokenHandler } from '@loganrenz/narduk-mapkit/node'

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
import { mapKitTokenResponseFromEnv } from '@loganrenz/narduk-mapkit/worker'

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
} from '@loganrenz/narduk-mapkit/apple-maps'

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
import { initializeMapKit } from '@loganrenz/narduk-mapkit/client'

await initializeMapKit({ tokenEndpoint: '/api/mapkit-token' })

const map = new window.mapkit.Map('map')
```

`initializeMapKit()` is a singleton. It shares the script load, initializes
MapKit once, reuses fresh tokens until they approach expiry, and coalesces
concurrent token refreshes.

## Shared Region Framing

Use package geometry to keep bounds logic out of app components:

```ts
import { computeMapKitRegionForDrawables } from '@loganrenz/narduk-mapkit/geometry'
import { createMapKitRegionForPoints } from '@loganrenz/narduk-mapkit/client'

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
} from '@loganrenz/narduk-mapkit/client'

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
} from '@loganrenz/narduk-mapkit/client'

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

When `bounds` are present, tile URLs outside the layer extent resolve to a
valid 1x1 transparent PNG data URI before any network request. `replace()`
requires an already-registered id and folds any still-fading overlays for that
id into the next crossfade. `unregister()` is a no-op for unknown ids.

## Playback

Playback helpers are plain TypeScript and do not require MapKit JS:

```ts
import {
  buildMapKitPlaybackLineSlices,
  formatMapKitPlaybackDuration,
  mapKitPlaybackProgressToIndex,
} from '@loganrenz/narduk-mapkit/playback'

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

These are intentionally small. Keep app styling, marker HTML, and data loading
in the app.

## API Surface

| Export | Purpose |
| --- | --- |
| `@loganrenz/narduk-mapkit/apple-maps` | Maps Server API auth exchange, access-token cache, search, and geocoding |
| `@loganrenz/narduk-mapkit/server` | Worker-safe Fetch responses, explicit config, Worker env bridge, token cache |
| `@loganrenz/narduk-mapkit/worker` | Explicit Worker-safe token entry point; never imports Node.js built-ins |
| `@loganrenz/narduk-mapkit/node` | Opt-in `process.env` and Doppler CLI resolution for Node server runtimes |
| `@loganrenz/narduk-mapkit/client` | MapKit JS loading, runtime constructors, tile overlays, layer registries, crossfades |
| `@loganrenz/narduk-mapkit/geometry` | Bounds, GeoJSON, drawable framing, distance, hit testing |
| `@loganrenz/narduk-mapkit/playback` | Route progress, line slicing, duration formatting |
| `@loganrenz/narduk-mapkit/token` | Low-level JWT signing and decoding |
| `@loganrenz/narduk-mapkit-nuxt` | Nuxt module, `AppMapKit`, composables, and token route |

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
   `@loganrenz/narduk-mapkit-nuxt`.
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
expectations and `docs/releasing.md` for the public npm publish order and proof.

There is no mutable `latest.tgz`, local publish poller, or absolute-path package
channel. Local tarballs are disposable test artifacts only; consumers use
immutable public npm releases.
