---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

Supabase account deletion (narduk-libs#1052, the rest of #923): a social-only
account (no `email` provider) now needs a recent sign-in — its `auth_sessions`
row created within `RECENT_SIGN_IN_WINDOW_SECONDS` (10 minutes) — or the delete
answers 403 `reauthentication_required`; it used to delete with no
re-authentication at all. The upstream session created by the current-password
check (deletion and password change) is signed out with `scope: 'local'` once
the check passes. Invited or magic-link users with the `email` provider are
held to the password on purpose, and the comment and README now say so.
