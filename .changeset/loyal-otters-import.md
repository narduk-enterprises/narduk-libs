---
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

Replace implicit reliance on `narduk-core`'s Nuxt auto-imports (`useAppFetch`,
`formatBuildTimeLocal`, `useLogger`, `requireAdmin`) with explicit imports from
`@narduk-enterprises/narduk-core/*` subpaths.

These composables/utils were previously called as bare globals, which only
resolves when a consuming app registers `narduk-core`'s Nuxt module with its
default options (`app: true`). A consumer that narrows the module surface (for
example `{ app: false, server: true }`, used by `spacex-ipo` to avoid a
component-registration collision with `narduk-seo`'s own `LayerAppFooter`) fails
`nuxt typecheck` with `Cannot find name 'useAppFetch'` the moment it also
depends on `narduk-seo` or `narduk-auth`, because those packages'
composables/components still assumed the global was present.

No behavior change: each site now imports the exact same function it was already
calling implicitly.

Bump `create-narduk-app` in step so its generated-app pins for `narduk-seo`,
`narduk-auth`, and `narduk-analytics` refresh to these patched versions.
