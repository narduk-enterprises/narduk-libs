# Narduk Libs Agent Guide

This repo owns the shared packages every Narduk app builds on: Nuxt 4 on
Cloudflare Workers with D1, plus the Swift kits. Packages publish independently
as `@narduk-enterprises/*`. Apps should be thin: what two apps need lives here.

## Layout

- `packages/modules/` Nuxt runtime modules and libraries; `packages/tooling/`
  build, lint, test and generator tooling; `packages/design/` the component
  suite, charts and maps; `packages/contracts/` shared types.
  `pnpm-workspace.yaml` is the source of truth for where a package lives.
- `packages/apple/` and the `swift/` trees in narduk-auth and narduk-logging are
  SwiftPM products of the root `Package.swift`, released on repository `vX.Y.Z`
  tags, not on npm.
- `scripts/` is this repo's own CI and release machinery. `docs/ci.md` and
  `docs/package-releases.md` describe it. `docs/plans/`, `docs/reports/` and
  `PLAN.md` are history.

## Rules

- Keep changes source-compatible for the apps already on a package. A breaking
  release needs Logan's yes.
- Fix shared behavior here, in the owning package, not in the app that found it.
  Build a reusable responsibility here from its first consumer; keep product
  policy in the app. An app-local workaround is temporary and says when it goes.
- This repo never syncs, reconciles or deploys an app. The generator
  (`create-narduk-app`) writes files; it calls no outside service.
- Publishing happens in CI only. Never publish by hand, and never commit a file
  that holds a token (`.npmrc.auth`).
- A shared component added or renamed also updates: its owning registry or
  export, eslint-config's `src/rules/utils/shared-components.ts`,
  narduk-app-tools' `src/foundation/shared-components.ts`, and libs-explorer's
  inventory with a complete usage example. `surface:check` names what is missing
  (README section, mount and SSR tests, design card). Declare file-reading
  consumers with `nardukWorkspaceInputs` so scoped CI runs their drift checks.
- Leave unrelated local changes alone.

## Validation

- `pnpm install` is all a fresh worktree needs: every dependency resolves from
  the public registry or the workspace, with no token. Its `postinstall` builds
  `eslint-config` and `narduk-testkit`. `create-narduk-app` imports
  `narduk-app-tools` from its `dist/`: build that first
  (`pnpm --filter @narduk-enterprises/narduk-app-tools run build`).
- For a touched package: `pnpm --filter <package> run quality` (format, lint,
  typecheck, unit tests). `quality` does not build; a package that commits its
  `dist/` (`narduk-mapkit`, `narduk-realtime`) also needs
  `pnpm --filter <package> run build`, or CI fails its dist-clean check.
- Seconds-long format check of a diff:
  `npx prettier --check $(git diff --name-only HEAD)`.
- A diff that adds a Changeset: `pnpm run release-plan:check`.
- CI is the full gate: the repo is public, CI runs on GitHub-hosted runners and
  the ruleset requires it. `pnpm run preflight` runs the non-browser half of CI
  locally; it is long (up to 50 minutes when the root `package.json` or the
  lockfile changes), so run it in the background, and only when the diff touches
  `.github/`, `scripts/` used by CI, `.changeset/config.json`, the root
  `package.json` or the lockfile. `--packages <name,name> --no-consumer` narrows
  it.
- New package releases must be installable from their packed artifact by a
  consumer fixture outside the workspace.

## Changesets and releases

- Every change to a published package's artifact needs a Changeset. A
  devDependency-only change, a test-only path and a Swift-only change do not
  (`docs/package-releases.md`, "When a Changeset is required").
- A Changeset that moves the version of a package the generator pins
  (`PACKAGE_VERSIONS` in `packages/tooling/create-narduk-app/src/manifest.ts`),
  directly or through an internal-dependency bump, also lists
  `'@narduk-enterprises/create-narduk-app': patch`. `release-plan:check`
  enforces it.
- A merge to `main` that carries a Changeset opens or updates the
  `chore: release packages` pull request. Merging that pull request publishes to
  GitHub Packages; `npm.nard.uk`, the mirror apps install from, follows (the
  release dispatches the sync; the sync's own schedule is the fallback). It
  publishes every pending package, so read its list first. The **Release
  publication proof** run is the end of the job, not the merge.
- A new public package must be on the mirror's allowlist before it can install:
  `docs/package-releases.md`, "New public packages".
- Never pin an app to a version that is not on `npm.nard.uk` yet, and never copy
  a fix into the app while waiting.

## Pull requests

- Small pull requests, one concern each. Squash merge; `gh pr merge --auto` once
  CI is running.
- Label an issue with one type (`bug`, `enhancement`, `documentation`,
  `question`, `tracker`), one priority (`P0-critical` to `P3-low`) and one
  `area:*` label that already exists (`gh label list`).
