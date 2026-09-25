---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

`GET /api/admin/users` and its `/api/users` alias now accept an admin-owned API key only when it carries the new `auth:admin:users:read` scope (or `*`). `PUT /api/admin/users/role` is now session-only, so no API key can grant or revoke admin, whatever its scopes. Admin sessions are unchanged.
