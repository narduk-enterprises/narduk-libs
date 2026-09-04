---
'@narduk-enterprises/narduk-charts': patch
---

Fold the standalone `narduk-charts` repository into this monorepo at
`packages/design/narduk-charts`, per company-hq D-WEBFOUND-2 (2026-09-04) Q2(a)
"One monorepo, four families." Full commit history was preserved via
`git filter-repo --to-subdirectory-filter` (confirmed with `git log --follow`
on a moved file, unlike `git subtree add`, whose default rename-detection does
not traverse the merge boundary for this case).

The package keeps its published name and version line
(`@narduk-enterprises/narduk-charts`, continuing from 2.5.0) and is now a
first-class libs package: it adopts the shared `eslint-config`, Prettier,
Turbo tasks, and Changesets, and its `exports["."]` map was restructured
(nesting `types` inside each of the `import`/`require` conditions, with a
matching `dist/index.d.cts`) to satisfy `publint --strict`, which the
standalone repo never ran. No runtime behavior changes; first-time lint
findings that touch real behavior are deferred to narduk-libs#131 rather than
fixed in this move. Part of company-hq#552.
