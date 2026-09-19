---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

`<AppMapKit>` now infers the app's item type in an SFC template
(narduk-libs#573, K-1). The exported type keeps only the generic construct
signature, so `create-pin-element`, `item-key`, `item-label`, `pin-geometry` and
the `#callout` scope accept callbacks narrowed to the app's own item type
without a cast. A vue-tsc template fixture in `tests/nuxt/template/` gates it.
