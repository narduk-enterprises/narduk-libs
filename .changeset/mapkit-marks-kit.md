---
'@narduk-enterprises/narduk-mapkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `@narduk-enterprises/narduk-mapkit/marks`, the point-map mark kit lifted from buoys (narduk-libs#517): the declutter engine, label placement, keyed mark layer, DOM pin builders, frame and camera math, and IQR overview framing. The Nuxt module gains an opt-in `marks` option that adds the marks stylesheet (`MAPKIT_MARKS_CSS`) after the host chrome.
