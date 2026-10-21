---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Pin `@nuxt/image` to 2.1.0 in narduk-core. 2.2.0 registers a server auto-import whose `from` is an object, which nitropack 2.13.5 cannot resolve, so `nuxt typecheck` crashed with `input.replace is not a function` in every generated app. Also document the widened `@nuxt/ui` peer range in the narduk-auth and narduk-core READMEs.
