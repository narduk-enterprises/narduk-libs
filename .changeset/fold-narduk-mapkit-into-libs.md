---
'@narduk-enterprises/narduk-mapkit': patch
---

Moved from the standalone `narduk-mapkit` repository into `narduk-libs` at
`packages/modules/narduk-mapkit`, with full git history preserved. The package
name, version line, export map, `dist/` contents and runtime behaviour are
unchanged; what changed is the repository it builds and publishes from. It now
runs the shared `@narduk-enterprises/eslint-config`, Prettier, and the Turbo
`lint`/`typecheck`/`build`/`test:unit`/`check:package` script contract that
`ci / Required` drives, and it releases through narduk-libs' Changesets pipeline
instead of its own workflow.
