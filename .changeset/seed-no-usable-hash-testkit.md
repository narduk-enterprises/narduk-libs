---
'@narduk-enterprises/narduk-testkit': patch
---

`loginAsAdmin(page, { email?, password? })` no longer signs in with a built-in password. It reads `E2E_ADMIN_PASSWORD` (and `E2E_ADMIN_EMAIL`, default `admin@example.com`) when no credentials are passed, and throws when there is no password. An app whose e2e suite relied on the old default sets `E2E_ADMIN_PASSWORD` to the password its own seed step hashes for the admin user.
