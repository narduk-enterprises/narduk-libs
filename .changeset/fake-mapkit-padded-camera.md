---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

Model MapKit's padded visible rectangle in the shared testing fake. Reading and
writing the rect now preserve annotation scale when a phone selection pans beneath
changing map chrome, using the measured container or configured viewport fallback.
