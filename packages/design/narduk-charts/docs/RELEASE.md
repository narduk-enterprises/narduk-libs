# Release Runbook

`@narduk-enterprises/narduk-charts` is released from
[narduk-libs](https://github.com/narduk-enterprises/narduk-libs), with the rest
of the monorepo's packages, to **GitHub Packages**
(`https://npm.pkg.github.com`). The full process, including the release PR,
registry preflight and the publication proof, is in the repository's
[package release runbook](../../../../docs/package-releases.md).

## Shipping a change

1. Make the change under `packages/design/narduk-charts`.
2. Run the package gate from the repository root:
   - `CI=true pnpm --filter @narduk-enterprises/narduk-charts run quality`
   - `pnpm --filter @narduk-enterprises/narduk-charts run test:e2e` for visual
     or interaction changes
   - `pnpm --filter @narduk-enterprises/narduk-charts run build` and
     `pnpm --filter @narduk-enterprises/narduk-charts run check:package`
3. Add a Changeset under the repository root's `.changeset/` naming
   `'@narduk-enterprises/narduk-charts'` with `patch`, `minor` or `major`. The
   generator pins this package, so the same Changeset also lists
   `'@narduk-enterprises/create-narduk-app': patch`;
   `pnpm run release-plan:check` enforces that.
4. Do not edit `version` in `package.json` or add a `CHANGELOG.md` section by
   hand. The `chore: release packages` PR does both.

## History

Through 2.6.0 the package was released from the standalone
`narduk-enterprises/narduk-charts` repository by pushing a `vX.Y.Z` tag. That
repository published 2.6.0 on 2026-09-23, after the source had moved here at
2.5.6, which left the registry's `latest` ahead of this package's version until
narduk-libs took 2.6.0 over. The registry preflight refuses to move `latest`
backwards, so a version published from anywhere else blocks every release here.
Publish only from narduk-libs.

## Consumer Install Smoke

Use a consumer app with GitHub Packages auth for the `@narduk-enterprises`
scope:

```bash
npm install @narduk-enterprises/narduk-charts
```

Then verify the shared stylesheet resolves:

```ts
import '@narduk-enterprises/narduk-charts/style.css'
```
