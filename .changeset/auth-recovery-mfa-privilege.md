---
'@narduk-enterprises/narduk-auth': minor
---

Restrict recovery-mode and unstepped MFA sessions at the grant validator, and
stop empty-scope API keys from acting as the user.

A password-recovery PKCE `?code=` callback now sets
`auth_sessions.recovery_mode` (from forwarded `type` or `next` targeting the
reset route). While that flag is set, `requireAuth` only allows
`GET /api/auth/me`, `POST /api/auth/change-password`, and
`POST /api/auth/logout`. Successful password change clears the flag; persist no
longer defaults omitted `recoveryMode` to `false`.

When `AUTH_REQUIRE_MFA` is on, Supabase sessions whose row `aal` is not `aal2`
are limited to MFA enroll/verify, logout, and `/api/auth/me`. **Local backend:**
the flag is ignored (startup warning). There is no TOTP stack to step up, so
enforcing it would lock password users out. Passkey user-verification is not
treated as AAL2.

Account delete, password change, profile update, and MFA enroll/verify now
require an interactive session. Notification mutations require
`auth:notifications:write`. Native Apple honors `AUTH_PUBLIC_SIGNUP=false`.
Recovery never inserts a new local user; invite remains the closed-signup door.
`isAdmin` (and email/name) are loaded from the current `users` row on every
refresh, including inside the Supabase 5-minute window. Static asset prefixes
are skipped by session-refresh middleware.

## Operator action

Re-mint or re-scope every `nk_` API key that calls `POST /api/notifications`,
`POST /api/notifications/read-all`, `PATCH /api/notifications/:id`, or
`DELETE /api/notifications/:id` with `auth:notifications:write` **before**
upgrading. Keys minted with the documented empty-scope default (`scopes: []`)
currently drive those mutations and will start returning 403 after this release.
Account delete, change-password, `PATCH /api/auth/me`, and MFA enroll/verify now
refuse API-key principals entirely.
