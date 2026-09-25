---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

`<AppMapKit>` zoom-to-fit frames points either side of the antimeridian the short way round. `mapKitBoundingRegion` now measures longitude with the same largest-gap span as `computeCoordinateBounds`, so points at 179.5 and -179.5 frame a 1-degree strip centred on 180 instead of a 359-degree arc centred on 0.
