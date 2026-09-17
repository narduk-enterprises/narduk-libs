---
'@narduk-enterprises/narduk-ai': patch
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/narduk-app': patch
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/narduk-devices': patch
'@narduk-enterprises/narduk-realtime': patch
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/narduk-shell': patch
'@narduk-enterprises/narduk-tenancy': patch
'@narduk-enterprises/narduk-uploads': patch
---

Correct published packaging declarations so they match what these packages
already require at install time. This is not a runtime change.

Nine Nuxt modules already depend on `@nuxt/kit` `^4.0.0`, which does not run on
Nuxt 3, but advertised `peerDependencies.nuxt` as `>=3.16.0`. The peer is now
`>=4.0.0`, matching narduk-shell and narduk-mapkit-nuxt. `narduk-core` and
`narduk-analytics` also add exact `./app/types/*` entries for the `.ts` files
that the `*.d.ts` export pattern could not resolve. The analytics key exports
runtime `const`s, so it carries `types` then `import` then `default`. Core
`./app/types/api` stays types-only because that file is interfaces. `narduk-app`
declares `zod` `^4.4.3` as an optional peer (kept in `devDependencies`) so
consumers that typecheck `./server/request-body` can resolve `z.ZodType` without
warning HTTP-only consumers. `narduk-shell` tightens `vue-router` to `^5.3.1` so
the published package matches `@nuxt/ui` `4.8.1` and the workspace override.
