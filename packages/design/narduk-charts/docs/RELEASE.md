# Release Runbook

`@narduk-enterprises/narduk-charts` publishes to **GitHub Packages**:

`https://npm.pkg.github.com`

## Prerequisites

- Root `.npmrc` scopes `@narduk-enterprises` to GitHub Packages (committed in this repo).
- CI and publish workflows use `tools/configure-package-registry-auth.mjs` (same as [`narduk-template`](https://github.com/narduk-enterprises/narduk-nuxt-template)).
- The publish workflow expects org secrets: `NARDUK_PLATFORM_GH_PACKAGES_READ` and `NARDUK_PLATFORM_GH_PACKAGES_WRITE`, or `NARDUK_PLATFORM_GH_PACKAGES_RW` for both.

## Release Steps

1. Update the implementation.
2. Run local verification:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
   - `npm run size`
   - `npm pack`
3. Bump the package version in `package.json`.
4. Update `CHANGELOG.md`.
5. Commit the release changes.
6. Create a tag in the format `vX.Y.Z`.
7. Push the branch and the tag to GitHub.
8. Confirm the **Publish package** workflow completed in GitHub Actions.
9. Confirm the version appears under the org packages and installs cleanly from a consumer app.

## Consumer Install Smoke

Use a consumer app with GitHub Packages auth for the `@narduk-enterprises` scope (see template `configure-package-registry-auth` / `package-registry:auth`):

```bash
npm install @narduk-enterprises/narduk-charts
```

Then verify the shared stylesheet resolves:

```ts
import '@narduk-enterprises/narduk-charts/style.css'
```
