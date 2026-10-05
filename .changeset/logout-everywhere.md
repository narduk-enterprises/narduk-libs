---
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add log out everywhere (narduk-libs#1043). `POST /api/auth/logout-everywhere`
and `useAuth().logoutEverywhere()` revoke native sessions when configured and
delete every other `auth_sessions` row, then sign this browser out. On the
Supabase backend the upstream sign-out stays app-local (#921).

Completing an MFA enrollment now ends the user's other sessions too; the browser
that proved the factor keeps its session. A sign-in step-up on an enrolled
factor ends nothing. narduk-auth has no email-change or MFA-unenroll route; the
README says a later one must revoke the same way.
