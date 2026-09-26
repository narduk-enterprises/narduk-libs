---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth: `GET /api/_auth/session` (nuxt-auth-utils' own route) no longer
returns the user of a revoked session (#1041). The route read the sealed cookie
and never asked the session-grant validator, and clearing the session did not
stop it, because h3 re-reads the request's cookie. The `auth-session-refresh`
middleware now answers `{}` for a cookie whose grant is revoked, expired or
unreadable.
