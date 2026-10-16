---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/narduk-mapkit': major
---

MapKit loads without an app-level CSP workaround, and pins land where
`pinGeometry` says (narduk-libs#1908).

**narduk-core** adds `'wasm-unsafe-eval'` to `script-src` for every app that
lists `@narduk-enterprises/narduk-mapkit` (or its `/nuxt` subpath, or the frozen
`-nuxt` adapter) in `modules`, on either baseline and wherever the module sits
in the list. MapKit JS 6.1 compiles `astc-loader.wasm`; without the keyword
every map load logged a `CompileError` and MapKit fell back to a slower path.
The keyword allows WebAssembly compilation only, never JS eval. An app that
added `allow: { script: ["'wasm-unsafe-eval'"] }` can drop it (a duplicate is
merged).

**narduk-mapkit** fixes the pin anchor at its root. MapKit JS centres an
annotation on the coordinate with its bottom edge on it and then moves it by the
**negative** of `anchorOffset` (measured on 6.0.128 and 6.1.182); 2.1.0 assumed
the top-left lands on `projected + anchorOffset`, and its fake agreed, so every
test passed. `mapKitAnchorOffset` now solves
`anchorPoint - (width / 2, height) - appOffset`, the callout points at the pin's
top-centre whatever the anchor (a `top-left` pin's callout was up to ~225 px too
far east), and the `./testing` fake places elements the way MapKit does. New:
`anchor` also takes an explicit `{ x, y }` point, and
`mapKitCalloutAnchorOffset` and `mapKitCoordinateWithinPin` are exported from
the geometry module.

**Breaking (3.0.0), visible on screen:** every pin with a `size` is now placed
differently from the previous library output, the default `bottom-center` pin
included. 2.1.0 handed MapKit `(-width / 2, -height)` for a sized
`bottom-center` pin; the library now hands it `(0, 0)`, MapKit's own default, so
the pin moves by `(width / 2, height)` on the screen. A `top-left`, `center`,
`top-center` or `{ x, y }` anchor, or an app `anchorOffset`, moves it by the
difference between the old and new maths. A pin with no `size` is unchanged.

An app that compensated for the old output has to adopt before it upgrades: pass
the point that marks the place (`anchor: 'center'`, or `{ x, y }`), and drop its
hand-measured offsets and its callout correction. Known consumers that shift
until they do:

- float-forecast, whose offset is `(-21, -34)`;
- borderwaitstat-us, 6, 8 and 12 px west depending on the pin;
- lakestat-us, 15 px west;
- bluebonnet, 9 px west;
- the Wave Transit concept breaks until it adopts (its `calloutShift` workaround
  and the app-level CSP `allow` entry go away).

`docs/api-2.1.md` §c.3 and §d item 8, which said `'wasm-unsafe-eval'` was not
needed, are corrected.

This is why `narduk-mapkit` is a major release. The README has a "Migrating from
2.x to 3.0" section covering the anchor model, the callout dismissal defaults
that arrive with the callout changes in the same release, and dropping the
app-level `'wasm-unsafe-eval'`.
