---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`versions-promote` reads the live version with the strict reader: tied or undated newest deployments refuse (stale-promote) unless `--force`. An unnamed `deploy rollback` refuses them too.
`deploy rollback` refuses a `pull_request` (or other non-promote) event, as `versions-promote` does.
`versions-promote` refuses (staging-not-proven) when `Config/cloudflare-app.json` exists but does not parse, instead of dropping the staging gate.
The staging gate searches up to the default version window and no longer calls a live version missing from the listing untagged.
`deploy versions-upload` refuses a caller `--message` inside a Workers Build, so the branch label promote trusts comes from `WORKERS_CI_BRANCH`.
Migration files sort numerically (`9999` before `10000`), and a migration source the ledger would not keep (anything but `app`, `app:*`, `package:*`, `@scope/*`) is refused before its first apply.
`verify --live` refuses a health, smoke or edge path that resolves to another origin.
Foundation: the comment stripper behind items 14 and 15 skips string contents, and item 12 reads single-quoted `binding` and `account_id` in `wrangler.toml`.
