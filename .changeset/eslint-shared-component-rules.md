---
'@narduk-enterprises/eslint-config': minor
---

Two rules keep apps on the shared components (narduk-libs#260).
`narduk/no-shadowed-shared-component` reports an app-local `.vue` component
whose file name, or the name Nuxt registers from its path, matches one that
narduk-shell, narduk-core, narduk-auth, narduk-ui or narduk-charts publishes.
`narduk/prefer-shared-collection` reports `<UTable>` outside narduk-shell's
`NeDataTable`. Both are on at `warn` in the design-system pack. The component
list lives in `src/rules/utils/shared-components.ts`, and a test fails when it
differs from the components the packages actually ship.
