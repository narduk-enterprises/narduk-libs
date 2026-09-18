---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Stop the unhandled `/api/_auth/session` SSR error in apps that have not
configured auth (narduk-libs#540). `coreModules` still installs
`nuxt-auth-utils` (dashboard chrome uses `useUserSession`), but passes the
module's existing `auth.loadStrategy: 'none'` unless the app already set a
strategy, has a session password (`NUXT_SESSION_PASSWORD`, `SESSION_PASSWORD`,
or `runtimeConfig.session.password`), or lists `narduk-auth` / `nuxt-auth-utils`
in `modules`. A no-auth fixture SSRs without that fetch and without an error
log. `create-narduk-app` is a companion patch so the generator pin moves with
core.
