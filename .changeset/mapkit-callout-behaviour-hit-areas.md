---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-mapkit': minor
---

`narduk-mapkit`: callouts behave, and pins are reachable.

`<AppMapKit>`:

- A callout is dismissed by a tap on empty map (`dismissOnMapClick`) and by
  `Escape` (`dismissOnEscape`), both on by default. Escape returns focus to the
  pin when focus was in the map, and the slot's `close()` returns it too instead
  of dropping it on `<body>`. An Escape aimed at a control elsewhere on the page
  is left alone.
- `calloutKeepInView` (default on) measures the callout and keeps it inside the
  map: it flips to the side with room, slides along an edge instead of being
  clipped, and writes `--mapkit-callout-caret-x` so a caret keeps pointing at
  the pin. A map or callout that cannot be measured keeps the plain placement.
  `MapKitCalloutHostLayer` takes `keepInView` and entries carry `layout`.
- `pinHitArea` grows each pin's tap target to 44 px (or a given size) without
  moving the glyph; `expandMapKitHitArea` and `MAPKIT_MIN_HIT_TARGET` are
  exported from `./geometry`.
- `pinNavigation="roving"` makes the pins one Tab stop with arrow-key, Home and
  End movement; `nextMapKitRovingKey` is exported from `./geometry`. The default
  `'tab'` is unchanged.
- `itemTooltip` shows an accessible hover and focus tooltip;
  `MapKitHoverTooltip` / `createMapKitHoverTooltip` are exported from
  `./client`.
- The pin geometry helpers (`mapKitAnchorOffset`, `mapKitCalloutAnchorOffset`,
  ...) are now reachable from `./geometry` for apps that place their own
  markers.

Fixes folded in from review: the callout is fitted again once its teleported
content has a size (a `ResizeObserver` on the host and a re-measure on the next
tick), a tap that lands on a pin or open callout, or that follows a pin's own
selection within 400 ms, no longer dismisses the callout it just opened,
`calloutFollowSelection: false` makes Escape and map-click dismissal no-ops, one
Escape closes a shown tooltip before the callout, the Escape listener is removed
from the document it was added to, and a removed pin detaches its tooltip
listeners.

**Warning: `dismissOnMapClick`, `dismissOnEscape` and `calloutKeepInView` are on
by default.** An app that already closes its own callout on `map-click` or
Escape, or that draws its own callouts, changes behaviour on upgrade: set
`calloutFollowSelection` to `false` (Escape and map-click dismissal then do
nothing), or pass the three props as `false`.

Behaviour change: with `calloutKeepInView` on, a callout that would have
overflowed an edge now stays inside it, and the host is positioned by its
top-left corner (the anchor is still `position` in the slot scope). Pass
`:callout-keep-in-view="false"` to keep the old placement.
