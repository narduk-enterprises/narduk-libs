---
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

The `local` auth backend now signs in a user whose `users.password_hash` holds an imported bcrypt hash (`$2a$`, `$2b$` or `$2y$`, cost 12 or lower — the shape Supabase `auth.users.encrypted_password` uses), verified with pure-JS `bcryptjs`. On success the row is rewritten as PBKDF2 in the same request, conditional on the row still holding that bcrypt hash. A failed or malformed bcrypt check fails exactly like a failed PBKDF2 check, and PBKDF2 hashes behave as before. `narduk-core` exports `isBcryptPasswordHash()` and `verifyUserPassword()` accepts bcrypt. The README documents the import contract.
