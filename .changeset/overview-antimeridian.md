---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

`mapOverviewCamera` (`./marks`) frames a point set that straddles the
antimeridian on its own data. It used a plain min/max of longitudes, so any
crossing set spanned 360 degrees minus its short arc and always fell back to
`NORTH_AMERICA_OVERVIEW`. Longitudes are now unwrapped around their largest gap
before the outlier trim (the rule `computeLongitudeSpan` uses); `span.lng` is
the short arc and `center.lng` is normalised to -180..180. A set whose largest
gap already sits across +/-180 is framed exactly as before (narduk-libs#932).
