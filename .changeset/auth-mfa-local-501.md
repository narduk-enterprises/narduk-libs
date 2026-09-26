---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth: `POST /api/auth/mfa/enroll` and `POST /api/auth/mfa/verify`
answer `501 MFA is only available when Supabase auth is enabled.` on the local
backend (#1048). They used to answer the Supabase-session 401, which reads as
an expired session and sends the user to sign in again for nothing.
