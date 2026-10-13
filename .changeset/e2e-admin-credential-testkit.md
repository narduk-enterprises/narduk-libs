---
'@narduk-enterprises/narduk-testkit': minor
---

Add a per-run E2E admin credential so the shared admin specs (`e2e/specs/users-api`, the admin test in `e2e/contracts/user-profile`) can call a bare `loginAsAdmin(page)` again with no committed password. `ensureE2eAdminPassword()` (new `e2e/admin-credential` export) sets a random `E2E_ADMIN_PASSWORD` at the top of `playwright.config.ts` unless the environment supplies one, and the new `narduk-testkit e2e seed-admin --database <name> --local` stores its PBKDF2 hash (narduk-core's `hashUserPassword()` format) on the seeded admin row in local D1. The command requires `--local`, refuses `--remote`, `--preview` and unknown flags, and never puts the password on a command line. Apps that run the shared admin specs add both lines to their harness; see the README section "E2E admin credential".
