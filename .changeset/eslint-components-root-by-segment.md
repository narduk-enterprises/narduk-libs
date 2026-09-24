---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/create-narduk-app': patch
---

`narduk/component-directory-structure` and `narduk/no-shadowed-shared-component` find a component's `components/` root by path segment instead of `indexOf('components/')` (narduk-libs#777). A checkout directory whose name ends in `components` — a worktree such as `core-module-app-components/` — is no longer taken for the root, so a local `pnpm run quality` stops reporting every component as "folder depth 7". A nested `my-components/` folder no longer cuts the path in half when the shadow rule computes Nuxt's component name. Both go through a new, tested `segmentsAfter` helper in `path-scope`.
