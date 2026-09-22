---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add owner-enrolled development mode (company-hq#781). `narduk-app development`
gains `deploy`, `status`, `enter`, `pin`/`unpin`, `exec`, `validate`, `handoff`,
`resolve` and `exit`. The optional `deployment.development` capability declares
targets. A host-private activation record grants custody. Deploys capture the
checkout, dirty edits included, and gate, build, upload, promote and prove the
exact build ID under a target lock shared with hotfixes. Entry holds classified
workflows and Workers Builds triggers and restores them exactly on exit, after
the merged release commit passes explicit validation. Existing apps are
unchanged until an owner enrolls them. See `docs/development-mode.md`.

create-narduk-app now emits a `deploy:dev` script, a private-app explicit
validation caller (`.github/workflows/validate.yml`, `narduk-validation/**`
pushes only) and a Development mode section in `docs/workers-builds.md`. It
never declares the capability.
