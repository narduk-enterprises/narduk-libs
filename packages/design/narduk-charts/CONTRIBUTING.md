# Contributing

## Development

```bash
npm install
npm run typecheck
npm run test
npm run build
npm run test:e2e
npm run size
```

- **Playground:** `npm run dev`
- **Stories:** `npm run story:dev`
- **E2E / screenshots:** `npm run test:e2e` (update baselines: `npm run test:e2e:update` on your OS)

Install used `--legacy-peer-deps` if npm reports peer conflicts with Histoire.

## Pull requests

- Keep changes focused; match existing style (Vue 3 Composition API, TypeScript).
- Run `npm run typecheck`, `npm run test`, `npm run build`, `npm run test:e2e`, and `npm run size` before opening a PR.

## Deprecations

- Prefer one minor release with a **dev-only** `console.warn` or typed `@deprecated` JSDoc before removing public props, events, or exports.
- Document removals in `CHANGELOG.md` and `docs/MIGRATIONS.md`.

## Versioning

Releases follow [Semantic Versioning](https://semver.org/). Update `CHANGELOG.md` under `[Unreleased]` for user-visible changes, then roll them into a version section on release.
