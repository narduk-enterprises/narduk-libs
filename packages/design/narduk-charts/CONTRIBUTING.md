# Contributing

## Development

```bash
npm install
npm run typecheck
npm run test
npm run build
```

- **Playground:** `npm run dev`
- **Stories:** `npm run story:dev`

Install used `--legacy-peer-deps` if npm reports peer conflicts with Histoire.

## Pull requests

- Keep changes focused; match existing style (Vue 3 Composition API, TypeScript).
- Run `npm run typecheck`, `npm run test`, and `npm run build` before opening a PR.

## Versioning

Releases follow [Semantic Versioning](https://semver.org/). Update `CHANGELOG.md` under `[Unreleased]` for user-visible changes, then roll them into a version section on release.
