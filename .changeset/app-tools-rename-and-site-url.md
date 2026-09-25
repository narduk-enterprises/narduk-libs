---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

The development-mode migration classifier treats the name an `ALTER TABLE ... RENAME TO` moves a table to as the file's own, so the rebuild that renames the original table out of the way and later drops it no longer reports a spurious `drop-table` (#876). `deploy-local` now refuses a blank, non-https or local `SITE_URL` before it builds, migrates or deploys, rather than after production has moved (#877); `--no-probe` still skips the check.
