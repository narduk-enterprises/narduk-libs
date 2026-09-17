---
'@narduk-enterprises/create-narduk-app': minor
---

Scaffold the single-source toolchain shape, and single-source the generator's
own copy of it.

A generated app now declares its Node version once, in `.node-version`, and its
pnpm version once, in the root manifest's `packageManager`. Both workflows read
those rather than restating them: `ci.yml` passes
`node-version-file: .node-version` to the shared workflow (workflows#97),
`copilot-setup-steps.yml` passes the same to `actions/setup-node`, and
`pnpm/action-setup` drops its `version:` input so it resolves `packageManager`
itself — the shape the shared `nuxt-cloudflare.yml`'s own pnpm step already
uses. `engines.node` and `volta.node` stay as mirrors, because Volta and npm can
read a version from a manifest and nowhere else. Node literals in a generated
app fall from six sites to three; pnpm from three to one plus a doc row.

**No `.nvmrc`.** Every consumer in this estate that reads it also reads
`.node-version` (setup-node, fnm, mise); the only tool that reads `.nvmrc` and
not `.node-version` is `nvm`, which is not the installed manager here — and
Volta, which is, reads neither, only `package.json`. A second dotfile with no
exclusive consumer is a drift site. `narduk-app foundation:check:toolchain`
still accepts an app-kept `.nvmrc` as an optional mirror and fails only if it
disagrees.

Inside the generator, `24.21.0` appeared in four places and `10.33.4` in three,
so a bump was a grep. `manifest.ts` now exports `NODE_VERSION`, `PNPM_VERSION`
and `PACKAGE_MANAGER`, and every emission site — the manifest, the two workflows
and the Workers Builds connection table — reads them.

**The shared-workflow pin moves to `6f56678` (workflows#97).** This is not
optional: a reusable workflow rejects an input it does not declare, so a caller
passing `node-version-file` to the previous pin would fail at startup. That
commit also adds an always-run required `caller-lint` job which actionlints the
**calling** repository's own workflows and audits them for workflow-level
concurrency, a top-level and a per-job `permissions:` block, per-job
`timeout-minutes`, and 40-character SHA pins. Every job this generator emits now
carries a job-level `permissions:` block for that reason (a job-level block
replaces the workflow level rather than merging with it), and
`tests/toolchain-single-source.test.ts` re-runs the gate's own rules over the
generated output so the templates cannot drift back. The pin deliberately stops
at `6f56678` rather than main's tip; #99 and #100 are separate decisions.

`.node-version` is deliberately **not** a managed target of the `upgrade`
codemod. A Node version is the same class of fact as a dependency pin, which
`ownership.ts` already excludes on the grounds that D-TOOLCHAIN-1 gives
Dependabot estate package currency — managing it would make the generator
re-impose its own Node on every app it touched, the continuing sync relationship
this repository's AGENTS.md forbids. `copilot-setup-steps.yml` stays managed
whole-file, and is now safer for it: the file no longer carries a version
literal at all, so re-applying it cannot move an app's toolchain behind its
back.
