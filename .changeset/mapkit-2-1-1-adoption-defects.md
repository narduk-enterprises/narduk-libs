---
'@narduk-enterprises/narduk-mapkit': patch
---

Fix the ten kit defects the first adopting app hit on 2.1.0.

**The one that made maps blank.** MapKit JS 6 resolves `mapkit.load(libraries)`
to a scoped namespace that is **not** `window.mapkit`, and a value built from
the global one is refused by your own map
(`Map.addAnnotations expected an annotation at index 0, but got [object EventTarget]`).
The fake collapsed the two into one object, so a suite could be green against it
and blank against Apple. The fake now models the split; `<AppMapKit>` hands the
right namespace over as `map-ready`'s **second argument** and as a new exposed
`getMapKit()` (both additive — no existing handler or ref breaks).

**The rest.** `<AppMapKit>`'s generic now reaches `createPinElement`, `itemKey`,
`itemLabel`, `pinGeometry` and the `#callout` slot, so an adopting component no
longer needs a cast at the call site. `mapType` and `colorScheme` are written to
a live map when the prop changes, not only in the constructor, and `mapType`
accepts Apple's `'mutedStandard'` beside this library's `'muted'`. The component
ships the host chrome as a module-injected stylesheet (single-class selectors,
first in `nuxt.options.css`, layout only) instead of making every app rewrite
it. A new `pinsFocusable={false}` makes pins decorative for a map whose pins are
not the interactive surface. A missing `itemLabel` now throws from `setup`
instead of during the first map init. And the fake models the rect camera
(`visibleMapRect`, `setVisibleMapRectAnimated`, `padding`) and records
degenerate inputs on `inspect.degenerateCameraInputs`.

**Operators:** no configuration changes, no route changes, no new environment
names. Apps on 2.1.0 upgrade in place. The one visible change is the stylesheet:
if your app already ships the `.mapkit-wrapper` / `.mapkit-canvas` /
`.mapkit-status` rules by hand, they still win (they load after ours and ours
are single-class with no `!important`), and you can delete them.
