---
'@narduk-enterprises/narduk-realtime': patch
---

Name the module's default export type explicitly. `@nuxt/kit` 4.5.x infers
`defineNuxtModule`'s return type from `@nuxt/schema` without re-exporting
`NuxtModule`, so declaration emit could not name it from a bare specifier
(TS2742). The published `dist/module.d.ts` now imports `NuxtModule` from
`@nuxt/schema` instead of the deep `nuxt/schema` path TypeScript inferred
before; the type itself is unchanged.
