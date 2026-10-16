---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/narduk-mapkit': minor
---

MapKit loads without an app-level CSP workaround, and pins land where
`pinGeometry` says (narduk-libs#1908).

**narduk-core** adds `'wasm-unsafe-eval'` to `script-src` for every app that
lists `@narduk-enterprises/narduk-mapkit` (or its `/nuxt` subpath, or the frozen
`-nuxt` adapter) in `modules`, on either baseline and wherever the module sits
in the list. MapKit JS 6.1 compiles `astc-loader.wasm`; without the keyword every
map load logged a `CompileError` and MapKit fell back to a slower path. The
keyword allows WebAssembly compilation only, never JS eval. An app that added
`allow: { script: ["'wasm-unsafe-eval'"] }` can drop it (a duplicate is merged).

**narduk-mapkit** fixes the pin anchor at its root. MapKit JS centres an
annotation on the coordinate with its bottom edge on it and then moves it by the
**negative** of `anchorOffset` (measured on 6.0.128 and 6.1.182); 2.1.0 assumed
the top-left lands on `projected + anchorOffset`, and its fake agreed, so every
test passed. `mapKitAnchorOffset` now solves
`anchorPoint - (width / 2, height) - appOffset`, the callout points at the pin's
top-centre whatever the anchor (a `top-left` pin's callout was up to ~225 px too
far east), and the `./testing` fake places elements the way MapKit does. New:
`anchor` also takes an explicit `{ x, y }` point, and `mapKitCalloutAnchorOffset`
and `mapKitCoordinateWithinPin` are exported from the geometry module.

Behaviour change: a pin whose `pinGeometry` has a `size` and a non-default
`anchor` or `anchorOffset` moves to the correct place. An app that worked around
the old maths by passing `anchor: 'top-left'` with hand-measured MapKit offsets
should pass the point that marks the place (`anchor: 'center'`, or `{ x, y }`)
and drop its offsets and its callout correction. A pin with the default
`bottom-center` anchor and no app offset is unchanged (`(0, 0)` is MapKit's own
default). `docs/api-2.1.md` §c.3 and §d item 8, which said `'wasm-unsafe-eval'` was
not needed, are corrected.
