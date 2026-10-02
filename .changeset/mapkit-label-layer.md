---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-mapkit': minor
---

Label layer that avoids marks (narduk-libs#1345 L9). `createLabelLayer` places
caller-supplied anchors (text, position, priority, first zoom, optional id) on a
canvas without covering an obstacle or another label: higher priority first,
ties on a stable key, a label that does not fit is dropped for the frame and is
never moved or shrunk. Only anchors in the view plus a margin are considered, a
per-frame cap defaults to 200, text is measured once per distinct string and
style in a bounded cache, a halo keeps it legible, and colours and font come
from the caller's style. Pixel-ratio aware; repaints coalesce through the render
scheduler. `labelAt` is the hit test, and `resolveHit` accepts a `label` layer
kind (the existing result types are unchanged). The point layer gains
`obstaclesInView(view, marginPx?)`, the visible dots as screen circles from its
typed arrays, and exports the projection the label layer shares. Everything new
is optional.
