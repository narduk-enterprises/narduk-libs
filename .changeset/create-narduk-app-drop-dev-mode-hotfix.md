---
'@narduk-enterprises/create-narduk-app': minor
---

Generated apps no longer get the `deploy:dev`, `deploy:local`, `deploy:hotfix`,
`hotfix:check` and `hotfix:build` scripts, the `.github/workflows/validate.yml`
explicit-validation caller, or the Development-mode and local-hotfix docs. Use
`pnpm ship` (`narduk-app ship`) for the workstation fast path on a committed
branch; the generated `docs/workers-builds.md` now has a short Ship section in
place of Development mode.
