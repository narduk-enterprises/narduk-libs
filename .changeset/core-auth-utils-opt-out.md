---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Add `nardukCore.auth` (default `true`) so a site with no accounts can skip `nuxt-auth-utils` and the empty `session.password` seed (narduk-libs#169). `auth: false` does not install the session module and does not register `/api/_auth/session`. Existing apps keep today's install. `create-narduk-app` is a companion patch so the generator pin moves with core.
