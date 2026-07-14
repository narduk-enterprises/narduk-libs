# Releasing the MapKit workspace

Both packages publish publicly to npm from this repository. Do not configure
the `@loganrenz` scope for GitHub Packages; the repository `.npmrc` and each
package's `publishConfig.registry` intentionally select npmjs.org.

## Preconditions

1. Start from a clean commit on `main` with passing CI.
2. Confirm the core and Nuxt package versions and changelog agree.
3. Run `pnpm install --frozen-lockfile` and `pnpm run quality`.
4. Run `pnpm run pack:artifacts` and retain the CI tarball artifact.
5. Confirm npm authentication or trusted publishing without printing tokens.

The quality gate builds the Nuxt adapter with `cloudflare-module`, explicitly
without Node compatibility. It fails on warnings, Node built-in imports, stale
committed core `dist/`, or a failed packed-fixture `503`/`403`/`200` proof.

## Publish order

Core must exist in npm before the Nuxt package because the packed Nuxt
manifest converts `workspace:^` to the matching public core range.

```sh
pnpm publish --access public --registry https://registry.npmjs.org
pnpm --dir packages/nuxt publish --access public --registry https://registry.npmjs.org
```

Publishing is an explicit release operation; CI validation and ordinary merges
must never publish automatically.

## Proof

```sh
npm view @loganrenz/narduk-mapkit version --registry https://registry.npmjs.org
npm view @loganrenz/narduk-mapkit-nuxt version --registry https://registry.npmjs.org
```

Create a clean Nuxt consumer that installs those exact registry versions, run a
Cloudflare module build, and verify the token route returns `503` unconfigured,
`403` for a blocked origin, `200` for an allowed non-enumerable Worker binding,
and `405` for non-GET methods. Record the package versions, commit, CI run, and
consumer proof in the release notes.
