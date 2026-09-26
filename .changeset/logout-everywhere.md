---
'@narduk-enterprises/narduk-auth': minor
---

Add log out everywhere (narduk-libs#1043). `POST /api/auth/logout-everywhere`
and `useAuth().logoutEverywhere()` sign this browser out, then delete every
`auth_sessions` row the user holds and revoke their native sessions. On the
Supabase backend the upstream sign-out stays app-local (#921).

Completing an MFA enrollment now ends the user's other sessions and native
sessions too; the browser that proved the factor keeps its session. A sign-in
step-up on an enrolled factor ends nothing. narduk-auth has no email-change or
MFA-unenroll route; the README says a later one must revoke the same way.
