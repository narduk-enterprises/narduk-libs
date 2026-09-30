---
'@narduk-enterprises/narduk-app-tools': patch
---

`narduk-app ship` no longer refuses a release when only the pnpm peer-resolution hash of a migration-carrying package changed (for example after a `@types/node` bump). The check now compares the resolved package version on the removed and added lockfile lines and ignores the `(peer-hash)` suffix.
