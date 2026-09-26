---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Bare `narduk-app doctor` now runs the dependency audit alongside the prerequisites and prints one verdict line first: `DOCTOR PASS|WARN|FAIL` (narduk-libs#376). It can newly exit 1 on an undeclared high or critical advisory; accept or bump it as `doctor --audit` describes. The audit runs at the nearest `pnpm-lock.yaml`, without leaving the git repository, so a generated app's `pnpm run doctor` in `apps/web` audits the root lockfile. `--json` keeps the old fields and adds `verdict`, `line`, `exitCode` and `audit`. The generated app README describes the new behaviour.
