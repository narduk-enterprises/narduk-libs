---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-app-tools': patch
---

The shared component lists (eslint-config's rules and narduk-app-tools' foundation check) name narduk-shell's `NeCollectionTable` (narduk-libs#1400), so the shared-component rules treat it like every other `Ne*` component.
