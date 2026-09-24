---
'@narduk-enterprises/narduk-mapkit-nuxt': patch
'@narduk-enterprises/create-narduk-app': patch
---

`<AppMapKit>` in the frozen Nuxt adapter moves focus into the callout when a pin
is selected from the keyboard (narduk-libs#746). Once the callout slot renders,
focus goes to its first focusable element, so a keyboard or screen-reader user
reaches the callout's action without tabbing back through the page. A pointer
selection leaves focus where it is. `calloutFocus="never"` opts out; the default
is `'keyboard'`.

The core `@narduk-enterprises/narduk-mapkit` package already shipped this in
2.9.0. This patch ports the same behaviour to the adapter apps still install.
