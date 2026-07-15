# @narduk-geo/narduk-mapkit-nuxt

Nuxt integration for `@narduk-geo/narduk-mapkit`. It adds the `AppMapKit`
component, `useMapKit`, `useMapkitToken`, and a Worker-compatible
`GET /api/mapkit-token` route.

## Install

```sh
pnpm add @narduk-geo/narduk-mapkit @narduk-geo/narduk-mapkit-nuxt
```

```ts
export default defineNuxtConfig({
  modules: ['@narduk-geo/narduk-mapkit-nuxt'],
})
```

The component fills its parent, so the parent must have an explicit height:

```vue
<template>
  <div style="height: 420px">
    <AppMapKit :items="stations" :create-pin-element="createPin" />
  </div>
</template>
```

Runtime names accepted by the token route:

- `APPLE_PRIVATE_KEY` or `APPLE_SECRET_KEY`
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `MAPKIT_ALLOWED_ORIGINS`
- `APPLE_MAPKIT_TOKEN` or `MAPKIT_TOKEN`

Cloudflare bindings are read from the request-scoped Nitro context. Nuxt
runtime-config equivalents (`applePrivateKey`, `appleSecretKey`, `appleTeamId`,
`appleKeyId`, `mapkitAllowedOrigins`, and `public.mapkitToken`) are supported as
fallbacks. Missing credentials return `503` with `{ configured: false }`.
The generated endpoint accepts GET only; other methods return `405` with
`Allow: GET`.

Provider-specific rate limiting remains app-owned. A server middleware can set
the request-scoped hook before the package route runs:

```ts
export default defineEventHandler((event) => {
  event.context.nardukMapKit = {
    rateLimit: async ({ origin }) => {
      const allowed = await consumeAppRateLimit(origin)
      return allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 60 }
    },
  }
})
```

The hook is optional so apps can instead enforce Cloudflare rate-limiting rules
at the edge. A denied hook response is `429` and may include `Retry-After`.

## Options

```ts
export default defineNuxtConfig({
  nardukMapKit: {
    component: true,
    composables: true,
    tokenRoute: true,
    tokenRoutePath: '/api/mapkit-token',
  },
})
```

Disable `tokenRoute` when the app provides its own endpoint. Override
`public.mapkitTokenEndpoint` when composables should call a different route.
