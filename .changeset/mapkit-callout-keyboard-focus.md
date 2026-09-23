---
'@narduk-enterprises/narduk-mapkit': minor
---

`<AppMapKit>` moves focus into the callout when a pin is selected from the
keyboard (narduk-libs#746). Once the `#callout` slot renders, focus goes to its
first focusable element, so a keyboard or screen-reader user reaches the
callout's action, such as a "View details" link, without tabbing back through
the page. A pointer selection leaves focus where it is. `calloutFocus="never"`
opts out; the default is `'keyboard'`. The pin layer's `onSelect` now receives a
second argument, `'keyboard' | 'pointer'`, which existing handlers can ignore.
An app that focuses the callout itself, as Buoys' `focusSelectedCalloutAction`
does, can delete that code.
