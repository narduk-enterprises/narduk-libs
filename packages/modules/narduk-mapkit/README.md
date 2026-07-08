# @loganrenz/narduk-mapkit

Framework-agnostic TypeScript helpers for Apple MapKit JS.

This package centralizes the mapping code Narduk apps keep repeating: MapKit JS
token routes, browser bootstrapping, coordinate and region math, GeoJSON and
drawable framing, tile overlay animation, and route playback utilities.

Core stays runtime-neutral. App code still owns framework components, marker
HTML, panels, data fetching, and domain-specific behavior.

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

## Install

```sh
pnpm add @loganrenz/narduk-mapkit
```

For local package-consumer testing before publishing, pack the current checkout
and install the generated tarball into the consumer app:

```sh
pnpm pack --pack-destination /tmp
pnpm add /tmp/loganrenz-narduk-mapkit-*.tgz
```

Or depend on Git directly:

```sh
pnpm add git+https://github.com/loganrenz/narduk-mapkit.git#main
```

## Server Token Route

Mount the Fetch handler at your app's token endpoint:

```ts
import { createMapKitTokenHandler } from '@loganrenz/narduk-mapkit/server'

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
`403`.

### Cloudflare Workers

Workers pass secrets through `fetch(request, env)`, not `process.env`:

```ts
import { mapKitTokenResponseFromEnv } from '@loganrenz/narduk-mapkit/server'

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
| `@loganrenz/narduk-mapkit/server` | Fetch responses, config lookup, Worker env bridge, token cache |
| `@loganrenz/narduk-mapkit/client` | MapKit JS loading, runtime constructors, tile overlays, layer registries, crossfades |
| `@loganrenz/narduk-mapkit/geometry` | Bounds, GeoJSON, drawable framing, distance, hit testing |
| `@loganrenz/narduk-mapkit/playback` | Route progress, line slicing, duration formatting |
| `@loganrenz/narduk-mapkit/token` | Low-level JWT signing and decoding |

## Maintainer Migration Notes

The repository keeps internal migration notes under `docs/`, but those notes are
not part of the published package artifact. The short version:

1. Move token routes to `server` helpers.
2. Move local script loaders to `initializeMapKit()`.
3. Move bounds, GeoJSON, and drawable framing to `geometry` and `client`
   region helpers.
4. Move MapKit tile overlay construction and fade loops to `client` runtime
   helpers.
5. Keep framework components, marker DOM, callouts, panels, and native Swift
   renderers outside this package.

## Security

Apple private keys belong only on the server side. Never pass
`APPLE_PRIVATE_KEY` or `APPLE_SECRET_KEY` to browser code.

Origin allowlists are optional for local tools, but production token endpoints
should set `allowedOrigins` or `MAPKIT_ALLOWED_ORIGINS`.

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

`pnpm run quality` runs typecheck, tests, build, package export smoke, and a
clean-room tarball install smoke.

`dist/` is committed so Git dependency consumers can install without running a
prepare build. When source exports change, run `pnpm run build` and commit the
matching `dist/` output.

See `CONTRIBUTING.md` for public API, testing, example, and release checklist
expectations.

Maintainers can refresh the local tarball with:

```sh
pnpm run publish:local
```
