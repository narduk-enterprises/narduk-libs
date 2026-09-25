---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

`hitTestPolygonOverlays` no longer reports a hit for a point inside a polygon's
hole. A drawable's `rings` are `[outer, ...holes]` and the overlay layer draws
the holes empty, so containment is now even-odd across rings; a tap on the
empty water of a lake no longer selects the surrounding polygon, and falls
through to a polygon drawn inside the hole (narduk-libs#931).
