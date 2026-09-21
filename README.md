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
- `@narduk-enterprises/libs-explorer` (private) -- the Libs Explorer site:
  components, foundations and the package catalog. `pnpm run explorer:dev`; see
  its [README](packages/design/libs-explorer/README.md).

### `packages/contracts/` -- shared contracts

- `@narduk-enterprises/narduk-platform`

## Consuming these packages

The source repository is public. Existing package artifacts may still be private
in GitHub Packages, so an external consumer needs package read access. This
workspace resolves its internal packages through `workspace:*` and its frozen
install needs no package token. Public pull requests run the same CI gates
without long-lived credentials.

Downstream applications should follow their own registry authentication contract
and keep credentials out of tracked npm configuration. Publication uses the
job-scoped `GITHUB_TOKEN` from this repository's protected release environment;
see [`docs/package-releases.md`](docs/package-releases.md).

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
scope using its job-scoped `GITHUB_TOKEN` and never dispatches to an app
repository.

The complete publish, partial-failure, and forward-only rollback procedure is in
[`docs/package-releases.md`](docs/package-releases.md).

## Fix Policy

Fleet app bugs that come from shared auth, runtime, Cloudflare, Nuxt, SEO,
analytics, upload, D1, KV, R2, or deployment behavior should be fixed in the
owning package. App-local workarounds must be explicitly justified, scoped, and
tracked for removal once the library fix is available.

Publishing uses GitHub Packages. The release job creates a temporary npm
configuration with its job token and removes it on completion.
