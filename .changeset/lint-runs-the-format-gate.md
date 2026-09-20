---
'@narduk-enterprises/create-narduk-app': patch
---

Make a generated app's root `lint` run prettier as well as eslint.

`lint` is the command a contributor or agent reaches for, and it was eslint
only. The formatting gate CI fails on is a different script -- the root
`format:check`, which the shared callable runs as the first entry in
`extra-scripts` -- so a prettier-only diff passed locally and failed CI, costing
a whole cycle for whitespace. Nothing a person naturally types ran both; only
`quality:static` chained them.

Root `lint` now composes the root `format:check`. The root one, not
`apps/web`'s: only it reaches `.changeset/`, root Markdown and `.github/`.
`lint:fix` and `quality:fix` are unchanged -- they already chain
`prettier --write` through `format` -- and `quality:static` keeps its own
explicit `format:check` first, so the fastest check still fails fastest and the
chain does not depend on how `lint` happens to be composed today.

narduk-libs#628.
