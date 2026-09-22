---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-app-tools': minor
---

Generated apps run `foundation:check:deployment` and
`foundation:check:shared-ui-pinned` with `--checkout ../..`, the repository
root. They used to pass `--checkout ..` from `apps/web`, which is `apps/`, and
item 12 read that as "no deployment block, not applicable" with exit 0 (#679).

The foundation checks now exit 1 when `--checkout` has no `package.json`, naming
the directory and the fix, so the old path cannot pass quietly. This covers
`foundation:check` and its `:shared-ui-pinned`, `:toolchain`, `:deployment` and
`:coverage` variants. **An app scaffolded before this fix must change
`--checkout ..` to `--checkout ../..` in `apps/web/package.json`** before it
takes this version.
