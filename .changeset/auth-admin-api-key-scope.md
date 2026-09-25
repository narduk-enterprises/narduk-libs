---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

The admin routes no longer take any API key whose owner is an admin. `PUT /api/admin/users/role` is now session-only, so an admin-owned key can't grant or revoke admin whatever its scopes. `GET /api/admin/users` and its `/api/users` alias now need the new `auth:admin:users:read` scope on an API key. Admin sessions are unchanged.
