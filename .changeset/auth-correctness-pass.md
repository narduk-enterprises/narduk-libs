---
'@narduk-enterprises/narduk-auth': minor
---

Correctness pass over the auth package:

- `POST /api/auth/session/exchange` now accepts the same
  `tokenHash`+`verificationType` shape as the GET route, and `AuthExchangePanel`
  handles Supabase `token_hash`+`type` email links instead of dead-ending with
  "The auth callback is missing its code."
- The Supabase password-recovery redirect is now a same-origin path, so the
  client exchange panel no longer throws on an absolute URL passed to
  `navigateTo` without `external: true`.
- `/reset-password?recovery=1` without a token no longer hides the
  current-password field on a runtime-confirmed local backend, where that form
  could never succeed (local changePassword always verifies the current
  password). While the runtime backend is unresolved the page keeps the recovery
  form, so Supabase recovery landings are unaffected.
- `PUT /api/admin/users/role` returns 404 for an unknown `userId` instead of
  silent success, and executes through the shared query path instead of
  `.run()`.
- Local email/password logins fail with a clear "apply
  drizzle/0002_local_email_auth.sql" message when the lockout table is missing;
  the hard migration coupling introduced in 1.20.0 is now documented in the
  README and CHANGELOG.
- `verifyMfa` reports `aal1` instead of asserting `aal2` when the session could
  not be persisted.
- Removed the dead `loginAsTestUser()` composable function (its
  `/api/auth/login-test` endpoint never existed) and the never-runnable
  `db:generate`/`db:studio` scripts (no drizzle config has ever shipped).
- `server/utils/accountDeletion.ts` is now a pure re-export of the bridge
  implementation instead of a byte-divergent copy; the un-suffixed names keep
  working.
- New passwords and profile names are capped at 200 characters (existing
  credential verification stays uncapped), and `auth_email_links.purpose` is
  typed to the `setup`/`reset` values the migration CHECK enforces.
