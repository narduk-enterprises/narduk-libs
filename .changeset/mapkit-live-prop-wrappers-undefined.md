---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

`<AppMapKit>` no longer throws a `TypeError` when `createPinElement` or `itemLabel` is set at mount and later becomes `undefined`. The pin layer's wrappers read the live prop with optional chaining, the same way `pinGeometry` and `itemKey` already did: a missing glyph renders an empty one, and a missing label writes the empty accessible name the pin layer defaults to (#1038).
