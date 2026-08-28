# Contributing

This workspace publishes a reusable MapKit JS core library and its narrow Nuxt
adapter. Keep app-specific UI, styling, analytics, data fetching, and product
workflows in consuming apps.

## Requirements

- Node.js 20 or newer.
- pnpm 10.33.4 through Corepack.

```sh
corepack enable
corepack prepare pnpm@10.33.4 --activate
pnpm install --frozen-lockfile
pnpm run quality
```

## Secrets And Local Config

Do not add `.env` files or dotenv scaffolding to this repo.

Narduk projects use Doppler for local secret-backed commands:

```sh
doppler run -- pnpm run quality
```

The library test suite should not require real Apple credentials. Use synthetic
fixtures and generated test keys. Never commit real private keys, tokens,
account identifiers, production payloads, screenshots containing secrets, or
personal data.

## Development Loop

- Keep root `src/` and `packages/nuxt/src/` as sources of truth. Regenerate core
  `dist/` with `pnpm run build`; the Nuxt adapter builds during `prepack`. The
  post-build gate requires committed `dist/` to match source exactly.
- Run `pnpm run quality` before committing. It validates both packages,
  including a clean-room Nuxt build installed only from packed tarballs.
- Keep `@narduk-enterprises/narduk-mapkit/worker` free of Node built-ins. Process and
  Doppler CLI lookup belongs only in the explicit `/node` entry point.
- Keep examples minimal and copyable. Do not move app styling, marker HTML,
  panels, domain data loading, or framework-specific workflows into core.

## Public API Changes

Treat exported names, module paths, types, response shapes, error shapes, cache
behavior, and singleton behavior as public contract.

When changing the public surface:

1. Update the relevant `src/**/index.ts` export.
2. Add or update tests for the behavior and package subpath.
3. Update README examples and API-surface docs.
4. Update `CHANGELOG.md` with the semver impact.
5. Run `pnpm run quality` and include the matching `dist/` output.

Additive compatible changes belong in minor releases. Bug fixes that preserve
contract belong in patch releases. Breaking changes need migration notes and a
major version, unless all private consumers are migrated in the same controlled
change before a public release.

## Release Checklist

- Working tree is clean.
- `pnpm run quality` passes from a clean checkout.
- CI passes on the commit being released.
- README, examples, changelog, package metadata, exports, types, and `files`
  are correct.
- No real credentials, private source data, or internal-only migration notes are
  included in the package artifact.
- The published artifact is traceable to a commit, version, changelog entry,
  and CI run.
