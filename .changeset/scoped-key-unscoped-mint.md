---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

`POST /api/auth/api-keys` now refuses, with a 403, an API-key caller that asks for no scopes unless that key holds `*` (narduk-libs#1122). An unscoped key keeps full admin reach on route-scoped admin routes, so a key holding `auth:api-keys:write` could otherwise mint its way past `requireAdminRouteScopes`. Sessions, and keys holding `*`, can still mint unscoped keys. narduk-core's `requireAdminRouteScopes` docs drop the caveat that pointed at this gap.
