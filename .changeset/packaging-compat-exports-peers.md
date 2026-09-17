---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-ai': minor
'@narduk-enterprises/narduk-analytics': minor
'@narduk-enterprises/narduk-app': patch
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/narduk-devices': minor
'@narduk-enterprises/narduk-realtime': minor
'@narduk-enterprises/narduk-seo': minor
'@narduk-enterprises/narduk-shell': patch
'@narduk-enterprises/narduk-tenancy': minor
'@narduk-enterprises/narduk-uploads': minor
---

Correct published packaging declarations so they match what these packages
already require at install time. This is not a runtime change.

Nine Nuxt modules already depend on `@nuxt/kit` `^4.0.0`, which does not run on
Nuxt 3, but advertised `peerDependencies.nuxt` as `>=3.16.0`. The peer is now
`>=4.0.0`, matching narduk-shell and narduk-mapkit-nuxt. `narduk-core` and
`narduk-realtime` also raise `@nuxt/schema` to `>=4.0.0` so it matches `nuxt`.
`narduk-core` and `narduk-analytics` add exact `./app/types/*` entries for the
`.ts` files that the `*.d.ts` export pattern could not resolve. The analytics
key exports runtime `const`s, so it carries `types` then `import` then
`default`. Core `./app/types/api` stays types-only because that file is
interfaces. `narduk-app` declares `zod` `^4.4.3` as an optional peer (kept in
`devDependencies`) so consumers that typecheck `./server/request-body` can
resolve `z.ZodType` without warning HTTP-only consumers. `narduk-shell` tightens
`vue-router` to `^5.3.1` so the published package matches `@nuxt/ui` `4.8.1` and
the workspace override.

## Operator action

The Nuxt 4 peer (`nuxt` and, where declared, `@nuxt/schema`) is a
consumer-visible floor raise, so the nine modules that advertised Nuxt 3 ship as
`minor`. Every narduk-app in the estate is already on Nuxt 4; Buoys is on 4.5.2.
A remaining Nuxt 3 app cannot take this release — and already could not run
these modules, because they depend on `@nuxt/kit` `^4.0.0`. `create-narduk-app`
is a companion patch so generator pins move with the minors. `narduk-app`
(optional zod peer) and `narduk-shell` (vue-router already at UI 4.8.1) stay
`patch`.
