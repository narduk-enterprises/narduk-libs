# narduk-libs

Reusable Narduk packages published independently under `@narduk-enterprises/*`.

This monorepo is the source for the shared libraries and focused one-shot tools
that production apps import directly. It is not a fleet template, sync service,
or Command control plane. The decommission ledger and archive gates live in
[`docs/architecture/narduk-template-decommission.md`](docs/architecture/narduk-template-decommission.md).

## Packages

- `@narduk-enterprises/narduk-platform`
- `@narduk-enterprises/narduk-app`
- `@narduk-enterprises/narduk-core`
- `@narduk-enterprises/narduk-auth`
- `@narduk-enterprises/narduk-seo`
- `@narduk-enterprises/narduk-analytics`
- `@narduk-enterprises/narduk-uploads`

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

Add a Changeset for each public package change. Changesets bump and publish only
the named packages, with immutable versions in GitHub Packages. The release
workflow authenticates the `@narduk-enterprises` scope using a short-lived
workflow secret and never dispatches to an app repository.

## Fix Policy

Fleet app bugs that come from shared auth, runtime, Cloudflare, Nuxt, SEO,
analytics, upload, D1, KV, R2, or deployment behavior should be fixed in the
owning package. App-local workarounds must be explicitly justified, scoped, and
tracked for removal once the library fix is available.

Publishing uses GitHub Packages. Use a temporary npm config or Doppler-provided
token material; do not commit auth files.
