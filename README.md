# narduk-libs

Reusable Narduk packages published independently under `@narduk-enterprises/*`.

This monorepo is the source for the shared libraries and focused one-shot tools
that production apps import directly. It is not a fleet template, sync service,
or Command control plane. The decommission ledger and archive gates live in
[`docs/architecture/narduk-template-decommission.md`](docs/architecture/narduk-template-decommission.md).

## Packages

`packages/` is organized into four families (company-hq `D-WEBFOUND-2` Q2 (a),
2026-09-04). Directory layout only -- published package names are unchanged and
every package still releases independently through Changesets.

### `packages/modules/` -- Nuxt runtime modules and layers

- `@narduk-enterprises/narduk-core`
- [`narduk-logging`](packages/modules/narduk-logging/README.md) -- shared
  TypeScript, Swift, and Python structured logging
- `@narduk-enterprises/narduk-auth`
- `@narduk-enterprises/narduk-seo`
- `@narduk-enterprises/narduk-analytics`
- `@narduk-enterprises/narduk-uploads`
- `@narduk-enterprises/narduk-ai`
- `@narduk-enterprises/narduk-app`
- `@narduk-enterprises/geogrid-web` -- framework-agnostic gridded geo-data
  overlay and Web-Mercator tile render (WebGL2 + CPU fallback), not
  Nuxt-specific

### `packages/tooling/` -- build, test and generator tooling

- `@narduk-enterprises/narduk-app-tools`
- `@narduk-enterprises/narduk-testkit`
- `@narduk-enterprises/eslint-config`
- `@narduk-enterprises/create-narduk-app`
- `@narduk-enterprises/journeys`

### `packages/design/` -- the coded NE design system

- `@narduk-enterprises/narduk-ui`
- `@narduk-enterprises/status-runtime`

### `packages/contracts/` -- shared contracts

- `@narduk-enterprises/narduk-platform`

## Consuming these packages

These packages are private and published to GitHub Packages, so a consuming app
needs read access before `pnpm install` resolves them.

**One credential, two names.** A single packages-read PAT is reached under
`GH_PACKAGES_READ` wherever the variable name is ours to choose, and under the
org-secret name only where GitHub fixes it. Do not add a third.

| Where          | Name                                                                                      | Source                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Local          | process env `GH_PACKAGES_READ`                                                            | Doppler `narduk/tokens:GH_PACKAGES_READ`, or nvault `github/prd/narduk-enterprises-packages-read` |
| CI             | org Actions secret `NARDUK_PLATFORM_GH_PACKAGES_READ`, **mapped into** `GH_PACKAGES_READ` | Organization secret, inherited by private repos (org is on Team)                                  |
| Workers Builds | build secret `GH_PACKAGES_READ` — the name is ours to choose, so there is nothing to map  | Same PAT; the org-secret spelling here leaves `GH_PACKAGES_READ` unset                            |

Commit an `.npmrc` that names the variable and holds no value:

```ini
@narduk-enterprises:registry=https://npm.pkg.github.com
@narduk-geo:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GH_PACKAGES_READ}
```

The auth line is plain, with **no bash-style default**. npm does not implement
default-value interpolation: it leaves the whole `${VAR-DEFAULT}` reference
unsubstituted and sends it to the registry as the token, so
`${GH_PACKAGES_READ-UNCONFIGURED}` fails
`401 … cannot be authenticated with the token provided` even when the variable
is set. pnpm does implement the default form, which is why that shape looked
fine here. An unset variable under the plain form is a loud install-time error
naming the variable, which is what you want.

In CI, map the org secret into that one name on the install step:

```yaml
- run: pnpm install --frozen-lockfile
  env:
    GH_PACKAGES_READ: ${{ secrets.NARDUK_PLATFORM_GH_PACKAGES_READ }}
```

`create-narduk-app` still emits the default form and its test pins that string;
correcting the generator and the fleet's committed files is
[company-hq#488](https://github.com/narduk-enterprises/company-hq/issues/488).
Until then this section, not the generator output, is the shape to copy.

Rules that make this stay one path:

- **Keep the token process-local.** Export it for the install
  (`nvault run -- pnpm install`, or a Doppler-provided value piped into the
  command) — never persist it in `~/.npmrc`, `.npmrc`, or any committed file.
- **No per-app aliases.** `HT_GH_PACKAGES_READ`, `NODE_AUTH_TOKEN`,
  `GH_PACKAGES_TOKEN`, and `NPM_TOKEN` are all banned spellings of this one
  credential; the estate is consolidating them away
  ([company-hq#488](https://github.com/narduk-enterprises/company-hq/issues/488)).
- **Write is a separate persona.** Publishing uses
  `NARDUK_PLATFORM_GH_PACKAGES_WRITE`; never reach for it to read.

Canonical policy: company-hq
[`docs/SECRETS-MATRIX.md`](https://github.com/narduk-enterprises/company-hq/blob/main/docs/SECRETS-MATRIX.md).
Release-side detail: [`docs/package-releases.md`](docs/package-releases.md).

## Commands

```sh
pnpm install
pnpm run quality
pnpm run release:dry-run
pnpm run release:consumer-smoke
pnpm run test
```

`release:dry-run` validates every public package with publint and a pnpm pack
listing without changing versions or publishing. `release:consumer-smoke` packs
the packages and installs those tarballs in a temporary directory outside the
workspace. Both commands are safe to run locally.

## Independent releases

Add a Changeset for each public package change. Changesets bump and publish the
named packages plus required internal dependents, with immutable versions in
GitHub Packages. The release workflow authenticates the `@narduk-enterprises`
scope using a short-lived workflow secret and never dispatches to an app
repository.

The complete publish, partial-failure, and forward-only rollback procedure is in
[`docs/package-releases.md`](docs/package-releases.md).

## Fix Policy

Fleet app bugs that come from shared auth, runtime, Cloudflare, Nuxt, SEO,
analytics, upload, D1, KV, R2, or deployment behavior should be fixed in the
owning package. App-local workarounds must be explicitly justified, scoped, and
tracked for removal once the library fix is available.

Publishing uses GitHub Packages. Use a temporary npm config or Doppler-provided
token material; do not commit auth files.
