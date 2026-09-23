---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

`types/**/*.d.ts` joins Nuxt's generated app, server, shared and node tsconfigs,
so a `nuxt/schema` runtime-config augmentation in `types/` types its keys
instead of leaving them `unknown` with no error (#669). An augmentation that was
inert before can now surface type errors it was hiding.
