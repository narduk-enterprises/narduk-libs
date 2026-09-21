---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Stop published server code from depending on a consumer-side runtime-config
augmentation.

`narduk-core` ships raw `.ts`, and a consumer's Nitro type program types
`useRuntimeConfig(event)` as `@nuxt/schema`'s `RuntimeConfig`
(`Record<string, unknown>`). `useHyperdriveConnectionString` indexed
`hyperdriveBinding || 'HYPERDRIVE'`, which is `{} | string` there, so every
consumer failed with TS2538 while this package's own `nuxt typecheck` stayed
green (narduk-libs#656, the same gap as #649). The legacy security-headers
middleware had the same shape on `public.appVersion` and the `csp*Src` keys: a
truthiness guard narrows `unknown` to `{}`.

Server code that reads a key the module actually writes now goes through
`coreRuntimeConfig(event)`. The type names only those keys — `hyperdriveBinding`
and the public version, CSP, and geolocation defaults from `src/module.ts` — and
leaves everything else `unknown`. A `tsconfig.consumer-server.json` project, run
from the package's vitest suite, compiles the shipped `runtime/server/**`
against that unaugmented view and fails if the view stops rejecting a direct
`hyperdriveBinding` index. `create-narduk-app` is a companion patch so the
generator pin moves with core.
