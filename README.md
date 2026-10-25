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

### `packages/modules/` -- Nuxt runtime modules and libraries

- [`@narduk-enterprises/geogrid-web`](packages/modules/geogrid-web/README.md)
- [`@narduk-enterprises/narduk-ai`](packages/modules/narduk-ai/README.md)
- [`@narduk-enterprises/narduk-analytics`](packages/modules/narduk-analytics/README.md)
- [`@narduk-enterprises/narduk-app`](packages/modules/narduk-app/README.md)
- [`@narduk-enterprises/narduk-auth`](packages/modules/narduk-auth/README.md)
- [`@narduk-enterprises/narduk-core`](packages/modules/narduk-core/README.md)
- [`@narduk-enterprises/narduk-devices`](packages/modules/narduk-devices/README.md)
- [`@narduk-enterprises/narduk-logging`](packages/modules/narduk-logging/README.md)
- [`@narduk-enterprises/narduk-mapkit`](packages/modules/narduk-mapkit/README.md)
- [`@narduk-enterprises/narduk-mapkit-nuxt`](packages/modules/narduk-mapkit-nuxt/README.md)
- [`@narduk-enterprises/narduk-notify`](packages/modules/narduk-notify/README.md)
- [`@narduk-enterprises/narduk-postgres`](packages/modules/narduk-postgres/README.md)
- [`@narduk-enterprises/narduk-realtime`](packages/modules/narduk-realtime/README.md)
- [`@narduk-enterprises/narduk-seo`](packages/modules/narduk-seo/README.md)
- [`@narduk-enterprises/narduk-tenancy`](packages/modules/narduk-tenancy/README.md)
- [`@narduk-enterprises/narduk-timeseries`](packages/modules/narduk-timeseries/README.md)
- [`@narduk-enterprises/narduk-uploads`](packages/modules/narduk-uploads/README.md)

### `packages/tooling/` -- build, test and generator tooling

- [`@narduk-enterprises/create-narduk-app`](packages/tooling/create-narduk-app/README.md)
- [`@narduk-enterprises/eslint-config`](packages/tooling/eslint-config/README.md)
- [`@narduk-enterprises/journeys`](packages/tooling/journeys/README.md)
- [`@narduk-enterprises/narduk-app-tools`](packages/tooling/narduk-app-tools/README.md)
- [`@narduk-enterprises/narduk-testkit`](packages/tooling/narduk-testkit/README.md)
- [`@narduk-enterprises/stylelint-config`](packages/tooling/stylelint-config/README.md)

### `packages/design/` -- the coded NE design system

- [`@narduk-enterprises/design-system-build`](packages/design/design-system-build/README.md)
  (private workspace tool)
- [`@narduk-enterprises/libs-explorer`](packages/design/libs-explorer/README.md)
  (private workspace tool)
- [`@narduk-enterprises/narduk-charts`](packages/design/narduk-charts/README.md)
- [`@narduk-enterprises/narduk-maps`](packages/design/narduk-maps/README.md)
- [`@narduk-enterprises/narduk-shell`](packages/design/narduk-shell/README.md)
- [`@narduk-enterprises/narduk-ui`](packages/design/narduk-ui/README.md)
- [`@narduk-enterprises/status-runtime`](packages/design/status-runtime/README.md)

### `packages/contracts/` -- shared contracts

- [`@narduk-enterprises/narduk-platform`](packages/contracts/narduk-platform/README.md)

## Find And Use Shared Capabilities

Use suitable exports here before writing an app-local replacement. Check this
catalog, then the owning README and public exports. Extend a missing capability
in its package, or build a clearly reusable responsibility here; keep product
policy in the app. If ordinary work reveals another app that benefits, file an
evidence-backed adoption issue there without hunting for adopters. See the
handbook's Reusable Libraries And Packages > Shared Libraries First.

Pagination is an end-to-end contract, not just a control:

| Capability                                   | Start here                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Validated list queries and responses         | [narduk-core](packages/modules/narduk-core/README.md#list-routes-parselistquery--listresponse): `parseListQuery`, `listResponse` |
| Keyset cursor helpers                        | [narduk-core](packages/modules/narduk-core/README.md#cursor-mode-keyset-cursors-with-list-cursor): `server/list-cursor`          |
| Shared list types                            | [narduk-platform](packages/contracts/narduk-platform/README.md)                                                                  |
| Offset collection fetching and pagination UI | [narduk-shell](packages/design/narduk-shell/README.md): `useCollection`, `NePager` (offset only)                                 |

Growing lists require source query bounds and reachable continuation. A hard cap
or browser slice alone does not provide pagination. Read the package API before
choosing offset versus cursor mode; preserve documented bounded catalogs,
snapshots and viewport queries when page controls would not fit the product.

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
