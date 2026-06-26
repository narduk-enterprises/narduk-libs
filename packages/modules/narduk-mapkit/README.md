# narduk-mapkit

Framework-agnostic Apple MapKit JS helpers extracted from the Narduk template maps layer.

This package exists so local web apps can boot MapKit quickly without each app
copying token-signing, script-loading, and geometry helpers.

The important path is:

1. Server code signs an origin-scoped MapKit JS JWT with Apple credentials.
2. Browser code loads `https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js`.
3. `mapkit.init()` uses an `authorizationCallback` that refreshes the token when
   it expires.

This is not a Nuxt layer. It works with any runtime that can expose a
Fetch-style `Request -> Response` route.

## Local Agent Quick Start

For same-Mac testing, prefer the local tarball. It avoids GitHub Packages and
npm auth entirely:

```sh
pnpm add "/Users/narduk/Library/Application Support/NardukMapKit/packages/loganrenz-narduk-mapkit-latest.tgz"
```

If the tarball is missing or stale, refresh the local publish poller:

```sh
script/package_publish_bootstrap.sh
```

The poller mirrors the Agent Hub deploy pattern:

- LaunchAgent: `com.narduk.mapkit.package-publish`
- Source: `origin/main`
- Build location: throwaway clone under `~/Library/Application Support/NardukMapKit/deploy/src`
- Output: `~/Library/Application Support/NardukMapKit/packages/loganrenz-narduk-mapkit-latest.tgz`
- Marker: `~/Library/Application Support/NardukMapKit/deploy/last-published-sha`

The live editing checkout is not touched by the poller. It records the marker
only after install, build, and pack succeed.

## Git Install

For a committed dependency that still avoids npm registry auth:

```sh
pnpm add git+ssh://git@github.com/loganrenz/narduk-mapkit.git#main
```

Use the tarball for fastest local iteration and the Git dependency when a repo
needs to resolve the package from GitHub.

## Server Route

Mount the Fetch handler at the app's token endpoint:

```ts
import { createMapKitTokenHandler } from '@loganrenz/narduk-mapkit/server'

export const GET = createMapKitTokenHandler({
  allowedOrigins: ['http://localhost:3000', 'https://example.com'],
})
```

The handler returns JSON:

```json
{ "configured": true, "origin": "http://localhost:3000", "token": "..." }
```

On misconfiguration it returns `503` with `configured: false` instead of
throwing framework-specific errors.

## Cloudflare Workers

Workers pass bindings through the `fetch(request, env)` argument, not
`process.env`, and have no `child_process` for the Doppler fallback. Use the
env-aware helper — token signing is pure Web Crypto, so it runs natively in
workerd (no `nodejs_compat` flag required):

```ts
import { mapKitTokenResponseFromEnv } from '@loganrenz/narduk-mapkit/server'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === '/api/mapkit-token') {
      return mapKitTokenResponseFromEnv(request, env)
    }
    return new Response('Not found', { status: 404 })
  },
}
```

`env` must expose `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY` as
Worker secrets. Set them with `wrangler secret put`, e.g. piping from Doppler so
the key is never printed:

```sh
doppler secrets get APPLE_PRIVATE_KEY --plain -p narduk -c tokens \
  | wrangler secret put APPLE_PRIVATE_KEY
```

The token's `origin` claim is derived from the request, so the same handler
works in local `wrangler dev` and in production. Pass `overrides` (a
`MapKitServerConfig`) for `allowedOrigins`, a custom TTL, etc.

## Credentials

The server config lookup order is:

1. Explicit handler config
2. Environment variables
3. Doppler project `narduk`, config `tokens`, via the local `doppler` CLI

Recognized secrets:

- `APPLE_PRIVATE_KEY` or `APPLE_SECRET_KEY`
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `MAPKIT_ALLOWED_ORIGINS`
- `MAPKIT_TOKEN` or `APPLE_MAPKIT_TOKEN` as a fallback pre-signed static JWT

`APPLE_PRIVATE_KEY` must be PKCS#8 PEM format with `BEGIN PRIVATE KEY`. Escaped
newlines are accepted.

Disable Doppler fallback when a test should prove missing configuration:

```ts
createMapKitTokenHandler({ doppler: false })
```

Do not send Apple private keys to the browser. Token signing belongs on the
server route only.

## Browser Boot

```ts
import { initializeMapKit } from '@loganrenz/narduk-mapkit/client'

await initializeMapKit({
  tokenEndpoint: '/api/mapkit-token',
})

const map = new window.mapkit.Map('map')
```

`initializeMapKit()` is a singleton. Multiple calls share script loading and
MapKit initialization. The authorization callback reuses a fresh token until it
nears expiry, then asks the token endpoint for a new one.

## Low-Level Token API

Use this when a framework wants to own its own response shape:

```ts
import { createMapKitToken } from '@loganrenz/narduk-mapkit/token'

const token = await createMapKitToken({
  privateKey: process.env.APPLE_PRIVATE_KEY!,
  teamId: process.env.APPLE_TEAM_ID!,
  keyId: process.env.APPLE_KEY_ID!,
  origin: 'http://localhost:3000',
})
```

For Apple Maps Server API auth-token signing, use
`createAppleMapsAuthToken()` with the Maps app id claim.

## Geometry And Playback

The geometry and playback helpers are plain TypeScript and do not require the
MapKit JS global:

```ts
import {
  computeCoordinateBounds,
  computeRouteDistanceMetres,
} from '@loganrenz/narduk-mapkit/geometry'
```

## Package Maintenance

Run the full local gate before pushing code changes:

```sh
pnpm run quality
```

Publish the current checkout to the local tarball manually:

```sh
pnpm run publish:local
```

GitHub Actions is manual and runs on the custom build host:

```sh
gh workflow run CI --ref main
```

Runner labels:

- `self-hosted`
- `macOS`
- `ARM64`
- `logans-imac-pro`
- `narduk-mapkit`

## Patterns For Agents

This repo follows the useful parts of the `grib-viewer` agent workflow:

- Keep one obvious green gate: `pnpm run quality`.
- Keep runtime data and generated artifacts out of Git.
- Make local prerequisites explicit instead of hiding them in tribal memory.
- Preserve unrelated dirty work and stage task files explicitly.
- Keep generated package output reproducible from source.

Use this package's README as the main agent runbook. This repo is intentionally
small, so adding more always-read docs should be rare.

## Do Not Do This

These are mistakes to avoid when working on this library:

- Do not turn this into a framework layer. No Nuxt, Next, Vite, Express, or
  Cloudflare runtime globals belong in core code.
- Do not create a maze of handoff, cleanup, wave, and phase docs for ordinary
  package work. If an instruction matters every time, put it here.
- Do not commit local package tarballs, `dist/`, `node_modules/`, `.env`, or
  agent run logs.
- Do not add a package dependency solely to run local agents. Agent tooling
  belongs outside this library unless it is part of the library itself.
- Do not publish through GitHub Packages for local testing. Use the local
  tarball or Git over SSH so app repos do not need npm auth setup.
- Do not let token handling drift into consuming apps. Apps should mount the
  server handler and call the browser initializer.
- Do not print or commit Apple/Doppler secret values while debugging. It is
  enough to verify that keys resolve.

## Agent Notes

- Prefer `@loganrenz/narduk-mapkit/server` for token routes and
  `@loganrenz/narduk-mapkit/client` for browser boot.
- Prefer the local tarball path for same-machine app testing.
- Do not introduce framework-specific runtime globals into the package core.
- Do not commit generated `dist/`, local package tarballs, `.env`, or Apple
  credentials.
- If public exports change, update `package.json` exports, README examples, and
  focused tests in the same commit.
