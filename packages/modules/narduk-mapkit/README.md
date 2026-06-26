# narduk-mapkit

Framework-agnostic Apple MapKit JS helpers extracted from the Narduk template maps layer.

The main job of this package is to make MapKit boot reliably in local web apps:

1. A server route signs an origin-scoped MapKit JS JWT with Apple credentials.
2. The browser helper loads `https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js`.
3. `mapkit.init()` uses an `authorizationCallback` that refreshes the token when it expires.

This is intentionally not a Nuxt layer. It works with any runtime that can expose a Fetch-style route.

## Install

```sh
pnpm add git+ssh://git@github.com/loganrenz/narduk-mapkit.git
```

For fastest same-Mac testing, use the local tarball published by the package
poller:

```sh
pnpm add "/Users/narduk/Library/Application Support/NardukMapKit/packages/loganrenz-narduk-mapkit-latest.tgz"
```

Install or refresh the poller:

```sh
script/package_publish_bootstrap.sh
```

It mirrors the Agent Hub deploy pattern: a LaunchAgent watches `origin/main`,
builds from a throwaway clone under Application Support, runs the quality gate,
packs the library, and updates `loganrenz-narduk-mapkit-latest.tgz` only after a
successful publish.

## Server Route

```ts
import { createMapKitTokenHandler } from '@loganrenz/narduk-mapkit/server'

export const GET = createMapKitTokenHandler({
  allowedOrigins: ['http://localhost:3000', 'https://example.com'],
})
```

If no config is passed, the handler reads environment variables first, then falls
back to Doppler project `narduk`, config `tokens` through the local `doppler`
CLI:

- `APPLE_PRIVATE_KEY` or `APPLE_SECRET_KEY`
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `MAPKIT_ALLOWED_ORIGINS` as a comma-separated allowlist

`APPLE_PRIVATE_KEY` must be a PKCS#8 PEM with `BEGIN PRIVATE KEY`. Escaped newlines are accepted.

Disable Doppler fallback explicitly when needed:

```ts
createMapKitTokenHandler({ doppler: false })
```

## Browser Boot

```ts
import { initializeMapKit } from '@loganrenz/narduk-mapkit/client'

await initializeMapKit({
  tokenEndpoint: '/api/mapkit-token',
})

const map = new window.mapkit.Map('map')
```

`initializeMapKit()` is a singleton. Multiple calls share the script load and the MapKit init promise.

## Lower-Level Token API

```ts
import { createMapKitToken } from '@loganrenz/narduk-mapkit/token'

const token = await createMapKitToken({
  privateKey: process.env.APPLE_PRIVATE_KEY!,
  teamId: process.env.APPLE_TEAM_ID!,
  keyId: process.env.APPLE_KEY_ID!,
  origin: 'http://localhost:3000',
})
```

For Apple Maps Server API auth-token signing, use `createAppleMapsAuthToken()` with the Maps app id claim.

## Geometry Helpers

```ts
import { computeCoordinateBounds, computeRouteDistanceMetres } from '@loganrenz/narduk-mapkit/geometry'
```

The geometry and playback helpers are plain TypeScript and do not require the MapKit JS global.
