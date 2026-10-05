---
'@narduk-enterprises/narduk-mapkit': minor
---

Add `fitMapKitRegionToViewport(bounds, viewport, options)` to `/geometry`: the MapKit region that
shows a longitude/latitude box whole in a canvas of a known pixel size. It centres on the box's
Mercator midpoint (not the mean latitude, which sits about a degree off for Alaska and cuts the
box at its top) and takes the tighter of the width and height fits, so a wide, short card and a
tall, narrow one both show the whole box plus its padding. Also exports
`mercatorDegreesFromLatitude` and `latitudeFromMercatorDegrees`. Pure numbers, no `mapkit` global.
