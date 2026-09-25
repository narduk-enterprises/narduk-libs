---
'@narduk-enterprises/narduk-testkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `server/kit/vitest` with `nuxtVitestAliases({ appRoot })` and
`server/kit/nitro-runtime-stub` (narduk-libs#998). The helper builds Vite
`resolve.alias` entries for Nuxt's `#` and `~` aliases from the table Nuxt
writes (`.nuxt/tsconfig.json`), so `#layer`, `#narduk-core/schema` and
`#narduk-core/postgres-runtime` follow narduk-core's `module.ts` (including the
postgres backend) instead of hand-copied paths. It never aliases a bare package
name, keeps exact and prefix keys distinct, and throws naming `nuxt prepare`
when the table is missing. `nitropack/runtime` (anchored) and `#imports` point
at one stub with `useRuntimeConfig`, `setTestRuntimeConfig`,
`resetTestRuntimeConfig` and a throwing `useEvent`.
