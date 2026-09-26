---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core: new `requireAdminRouteScopes(admin, scopes)` lets an admin route
opt into an API-key scope (#971, "scopes per route, opt-in"). A key that
carries scopes must hold the ones the route names, or `*`. A key with no scopes
keeps its full admin reach, and sessions are unchanged.
`GET /api/runtime/status` now names `runtime:status:read`, so an admin-owned key
minted for another purpose (for example `['registry:read']`) is refused there
with 403.
