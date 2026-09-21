---
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

Stop the published server sources from depending on a consumer-side
runtime-config augmentation.

`narduk-analytics` ships raw `.ts`, so a consumer compiles `server/**` inside
its own Nitro type program — where the runtime-config augmentation this module
registers does not take effect. Every `runtimeConfig` key is `unknown` there,
and a truthiness guard narrows `unknown` to `{}`, so `config.ownerTagSecret`
flowing into a `string` failed in every consumer while this package's own
`nuxt typecheck` stayed green.

Server code now reads config through a package-owned
`analyticsRuntimeConfig(event)` accessor whose `AnalyticsServerRuntimeConfig`
type promises only what `src/module.ts` actually defaults, so the same types
hold in this workspace and in a consumer. A new `tsconfig.consumer-server.json`
project, run from the package's vitest suite, compiles the shipped `server/**`
against a deliberately unaugmented ambient context so the gap cannot reopen
silently.
