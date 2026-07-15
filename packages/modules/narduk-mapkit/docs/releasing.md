# Releasing the MapKit workspace

Both packages publish from this repository to GitHub Packages under the
repo-aligned `@narduk-geo` scope. GitHub requires authentication for npm-format
package installs even when package visibility is public, so consumers route
only `@narduk-geo/*` to `https://npm.pkg.github.com` and provide a read token.

## Preconditions

1. Start from a clean commit on `main` with passing CI.
2. Confirm the core and Nuxt package versions and changelog agree.
3. Run `pnpm install --frozen-lockfile` and `pnpm run quality`.
4. Run `pnpm run pack:artifacts` and retain the CI tarball artifact.
5. Confirm the release workflow has `packages: write` permission; it publishes
   with the repository-scoped `GITHUB_TOKEN` and never prints the token.

The quality gate builds the Nuxt adapter with `cloudflare-module`, explicitly
without Node compatibility. It fails on warnings, Node built-in imports, stale
committed core `dist/`, or a failed packed-fixture `503`/`403`/`200` proof.

## Publish order

Core must exist in GitHub Packages before the Nuxt package because the packed
Nuxt manifest converts `workspace:^` to the matching core range.

Tag the verified `main` commit with the exact package version, for example
`v1.0.0`. The tag-triggered release workflow validates the candidate, publishes
core before the Nuxt adapter, and runs the clean registry-consumer proof.

Publishing is an explicit tag operation; CI validation and ordinary merges do
not publish.

## Proof

```sh
npm view @narduk-geo/narduk-mapkit version --registry https://npm.pkg.github.com
npm view @narduk-geo/narduk-mapkit-nuxt version --registry https://npm.pkg.github.com
```

Both commands require an npm client auth entry backed by a GitHub token with
`read:packages`.

The release workflow creates a clean Nuxt consumer that installs those exact
registry versions, runs a Cloudflare module build, and verifies the token route
returns `503` unconfigured, `403` for a blocked origin, `200` for an allowed
non-enumerable Worker binding, and `405` for non-GET methods. Record the package
versions, commit, CI run, and consumer proof in the release notes.
