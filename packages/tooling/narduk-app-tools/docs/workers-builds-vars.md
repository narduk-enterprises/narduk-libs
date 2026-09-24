# Workers Builds and `wrangler.json` vars

Workers Builds injects Worker secrets at **runtime** only. It does not export
`wrangler.json` / `wrangler.jsonc` `vars` into the `nuxt build` environment, so
`process.env.SITE_URL` and `process.env.NUXT_PUBLIC_*` are empty on that path
even when the same keys are set in Wrangler. Public runtime config that reads
those values at build time — prerendered HTML, narduk-core's `allowGeolocation`
/ CSP allowlists — then ships the empty default.

This is the same class of Workers Builds trap as setting
`NUXT_PUBLIC_ALLOW_GEOLOCATION` only in `wrangler.json` and expecting
narduk-core to see it during `nuxt build` (narduk-libs#516).

Do not hand-roll a `public-runtime-from-wrangler.ts` reader. Import the helper
from this package.

## Adopt it

Call the helper at the top of `apps/web/nuxt.config.ts`, before
`defineNuxtConfig`. Already-set environment values (Workers Builds **Build
variables**, CI, local) win; wrangler `vars` fill only what is missing.

```ts
import {
  applyWranglerVarsToEnv,
  publicRuntimeFromWrangler,
} from '@narduk-enterprises/narduk-app-tools/wrangler-public-runtime'

applyWranglerVarsToEnv()

export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      ...publicRuntimeFromWrangler(),
    },
  },
})
```

`applyWranglerVarsToEnv()` is enough for existing `process.env.X` reads,
including narduk-core's `NUXT_PUBLIC_ALLOW_GEOLOCATION` check. Spread
`publicRuntimeFromWrangler()` when the app needs keys that are not already
declared on `runtimeConfig.public` — Nuxt only overlays `NUXT_PUBLIC_*` onto
keys it already knows.

The helper resolves `wrangler.jsonc` then `wrangler.json` from the current
directory or `apps/web`. Pass `wranglerPath` or `cwd` to override. A named
Wrangler environment overlays top-level `vars` when `wranglerEnv` or
`NUXT_WRANGLER_ENVIRONMENT` is set.

## What is public

`NUXT_PUBLIC_*` vars become camelCase public keys
(`NUXT_PUBLIC_ALLOW_GEOLOCATION` → `allowGeolocation`). Known public Worker vars
(`SITE_URL`, `POSTHOG_PUBLIC_KEY`, `CSP_*_SRC`, …) map onto the narduk-core
public overlay. Secret-named keys (`NUXT_SESSION_PASSWORD`, `*_TOKEN`,
`*_SECRET`) are applied to the build environment and never copied into
`runtimeConfig.public`.

True secrets still belong in Worker secrets or Workers Builds **Build
variables**, not in committed `vars`.
