---
'@narduk-enterprises/create-narduk-app': minor
---

Add a `create-narduk-app upgrade [dir]` codemod that re-applies the units the
generator still owns in an already-scaffolded app, as a reviewable diff
(narduk-enterprises/company-hq#745). It is dry-run by default — printing a
unified diff and exiting 1 when a managed unit has drifted, so CI can use it as
a check — and `--write` applies exactly what the dry run printed. `--only`
limits a run to one path and `--json` prints the machine-readable report.

Ownership is explicit and deliberately narrower than "the generated file", so
app-owned content is never clobbered: the shared-workflow **pin** inside an
app-owned `.github/workflows/ci.yml`, the **whole** `copilot-setup-steps.yml`
and `dependabot.yml`, the marker-delimited `narduk:router` **region** of
`AGENTS.md` and `narduk:e2e-policy` region of `docs/e2e-testing.md`, and the
named contract **script bodies** in the root `package.json` (`build:ci`,
`foundation:check`, `manifests:validate`, and the `db:migrate:*` pair on an app
with a database). Everything else the generator emits is seeded: written once
and never read again. Any managed file can be disowned with a `narduk:unmanaged`
header comment. The generator's `AGENTS.md` template now emits the router
markers so new apps are opted in from scaffold.

Also bumps two stale GitHub Action pins in the generated workflows —
`actions/checkout` to v7.0.1 and `pnpm/action-setup` to v6.1.0, both verified
tag-to-SHA upstream. Running the new codemod against the reference app is what
surfaced them: the app was current and the template was a release behind.
