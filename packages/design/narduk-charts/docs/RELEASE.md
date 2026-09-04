# Release Runbook

`@narduk-enterprises/narduk-charts` publishes to **GitHub Packages**:

`https://npm.pkg.github.com`

## Prerequisites

- Root `.npmrc` scopes `@narduk-enterprises` to GitHub Packages (committed in
  this repo).
- CI and publish workflows use the repository-owned
  `tools/configure-package-registry-auth.mjs` helper.
- The publish workflow expects org secrets: `NARDUK_PLATFORM_GH_PACKAGES_READ`
  and `NARDUK_PLATFORM_GH_PACKAGES_WRITE`, or `NARDUK_PLATFORM_GH_PACKAGES_RW`
  for both.

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
6. **Land the release commit on `main` before tagging it.** Tag a commit that is
   an ancestor of `main`, never one that only exists on a release branch.
   `v2.4.0` was cut off a branch that never merged back (narduk-charts#32): the
   package published fine, but `main` then declared `2.3.0` while `2.4.0` was in
   the registry, and step 3 above reads that stale number. Verify before
   tagging:

   ```bash
   git fetch origin main
   git merge-base --is-ancestor HEAD origin/main && echo "on main" || echo "NOT on main — do not tag"
   ```

7. Create a tag in the format `vX.Y.Z`.
8. Push the tag to GitHub.
9. Confirm the **Publish package** workflow completed in GitHub Actions. Note
   that its "Check published package version" step **skips** the publish when
   the version already exists in the registry and the run still reports success
   — so read that step's output, not just the run's conclusion.
10. Confirm the version appears under the org packages and installs cleanly from
    a consumer app.

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
