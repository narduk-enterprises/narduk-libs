---
"@narduk-enterprises/create-narduk-app": minor
---

Emit and upgrade the complete repository gate (company-hq NAC-GATE-PARITY,
§3.11), and harden the promote template to NAC-DEPLOY-CONFORM.

- **Generated scripts.** Root `foundation:check:coverage`,
  `foundation:check:toolchain` and `foundation:check:deployment` (web-foundation
  items 9, 11 and 12), each writing one JSON artefact under `foundation-check/`
  like the reference app.
- **Private CI.** `extra-scripts` also names `foundation:check:coverage`,
  `foundation:check:toolchain` and `foundation:check:deployment` beside
  `foundation:shared-ui-pinned`. Items 1-7 (`foundation-check: true`) and item
  10 (`quality-level: standard`, on the pull request's preview) were already
  wired.
- **Public CI.** After `quality:static`, a "Repository gate" step runs items 8,
  9, 11 and 12. Item 10 is a new step that serves this commit's `build:ci`
  Worker on 127.0.0.1 with `narduk-app e2e-serve` and runs the published
  `narduk-app foundation:check:security-headers` against it. It never reads
  production. Items 1-7 are **not** run in a public app's CI: sub-check 5.1 is
  `UNKNOWN` app-side by specification (company-hq WEB-FOUNDATION-CHECK.md item
  5), so `foundation:check` exits 2 whatever the app does. The workflow says so
  in a comment instead of tolerating that `UNKNOWN`.
- **`upgrade`.** The `ci.yml` unit now also completes the gate. On a private
  caller it appends the missing gate scripts to `extra-scripts` (keeping the
  app's names and quoting), sets `quality-level: standard`, and adds
  `performance-budget-args: --app-dir apps/web` where `standard` needs it. On a
  public workflow it inserts the two steps. It never writes a
  `quality-opt-out`. A caller with `preview-checks: none` and no recorded
  security-headers opt-out keeps its level and reports `unresolved` (printed
  `partial` after `--write`). The four gate scripts are create-only in
  `package.json`, and the AGENTS.md quality bar follows the level the caller
  will have after the run.
- **Promote template** (`docs/workers-builds.md` excerpt,
  `docs/deployment/promote-d1.steps.yml`). The gate admits only a successful
  push or dispatch CI run on `main` from this repository. It promotes main's
  head only when `ci / Required` passed in one of main's own CI check suites.
  The newest attempt wins by check-run id, so a queued or in-progress re-run
  fails closed. The automatic rollback step is replaced by a manual-recovery
  notice (`rollback.mode: manual`). The D1 steps now take `VERIFIED_SHA` from
  the gate output instead of `workflow_run.head_sha`, which is empty on a
  dispatch and can name an older commit than the one the gate promotes.

Minor, not patch: generated CI and `upgrade`'s writes change for every app.
Compatibility risks: a private app upgraded to `quality-level: standard`
starts running the performance budget and the preview header probe, and fails
until its CSP is enforced (upgrade warns when the Nuxt config shows no
`enforce: true`). A public app's CI now fails on a FAIL or UNKNOWN from items
8-12.
