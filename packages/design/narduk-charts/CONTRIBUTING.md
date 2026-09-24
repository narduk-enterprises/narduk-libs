# Contributing

**Naming:** The product is **NardukCharts**. Published packages use the scope
**`@narduk-enterprises/narduk-charts`**—keep that distinction in UI copy and
documentation.

## Development

This package lives in
[narduk-libs](https://github.com/narduk-enterprises/narduk-libs) at
`packages/design/narduk-charts`. From the repository root:

```bash
pnpm install
CI=true pnpm --filter @narduk-enterprises/narduk-charts run quality
pnpm --filter @narduk-enterprises/narduk-charts run build
pnpm --filter @narduk-enterprises/narduk-charts run test:e2e
pnpm --filter @narduk-enterprises/narduk-charts run size
```

`quality` runs the format check, lint (with its `lint-budget.json`), typecheck
and unit tests; `CI=true` keeps `narduk-lint` from rewriting the budget file.

- **Histoire:** `pnpm --filter @narduk-enterprises/narduk-charts run dev` (alias
  of `story:dev`)
- **E2E / screenshots:** `test:e2e` (update baselines with `test:e2e:update` on
  your OS)

## Pull requests

- Keep changes focused; match existing style (Vue 3 Composition API,
  TypeScript).
- Run the commands above before opening a PR, and follow the repository's
  `AGENTS.md` for the repo-wide gates (`pnpm run preflight`).

## Deprecations

- Prefer one minor release with a **dev-only** `console.warn` or typed
  `@deprecated` JSDoc before removing public props, events, or exports.
- Document removals in `CHANGELOG.md` and `docs/MIGRATIONS.md`.

## Versioning

Releases follow [Semantic Versioning](https://semver.org/). Record each
user-visible change as a Changeset in the repository root's `.changeset/`; the
release PR bumps `package.json` and writes `CHANGELOG.md`. See
[docs/RELEASE.md](./docs/RELEASE.md).
