---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/narduk-auth': patch
---

Make the sealed `nuxt-session` cookie a pointer to `auth_sessions`, not the
grant itself.

`requireAuth` now consults an optional session-grant validator that narduk-auth
registers on the request. Core-only apps (no validator) keep cookie-as-grant
behavior. Apps that install narduk-auth fail closed: a cookie whose
`auth_sessions` row is missing, expired (local), or never existed no longer
authenticates.

**Operational consequence.** After deploy, existing sealed cookies whose
`auth_sessions` row is absent will stop authenticating. That may log some users
out once — including local-email sessions minted before this change, which never
wrote a row. They sign in again and receive a server-side session. Logout and
password change now revoke other browsers that still hold a copy of the cookie.

Login (not the per-request refresh path) opportunistically deletes a
`LIMIT`-bounded batch of expired `auth_sessions` rows via the existing
`expires_at` index. Supabase rows now carry the same 30-day absolute expiry as
local sessions so abandoned rows are sweepable.

This is a patch: exported function signatures are unchanged, and the behavior
change is a security correction, not a new API.
