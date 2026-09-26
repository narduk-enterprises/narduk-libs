---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

Supabase backend: a social-only session (no `email` provider) must have signed in within `RECENT_SIGN_IN_WINDOW_SECONDS` (10 minutes) to set its first password through `POST /api/auth/change-password`; an older session gets 403 `reauthentication_required`. Before, it could set a password with no proof, sign in with it, and so satisfy the recent-sign-in window that account deletion relies on (narduk-libs#1075). Recovery sessions are exempt.
