---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/create-narduk-app': patch
---

`composable-primary-export` and `require-use-prefix-for-composables` now check aliased named exports (`export { helper as useCartHelper }`). Both rules looked the export up by its alias instead of the local declaration it names, so every renamed export was skipped.
