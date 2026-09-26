---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

`shared/utils/units` adds `formatLatitude`, `formatLongitude` and `formatCoordinate`: a position with hemisphere letters in decimal degrees, degrees and decimal minutes, or degrees-minutes-seconds, rounded once and carried so it never prints `60′`. `useFormatters()` binds it as `format.coordinate` (narduk-libs#995).
