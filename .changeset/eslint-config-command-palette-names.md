---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-app-tools': patch
---

List `NeCommandPalette` and `NeCommandPaletteTrigger` as narduk-shell components, so
`no-shadowed-shared-component` and the item 13 no-local-copy check know them and the drift
test matches the shell's registry.
