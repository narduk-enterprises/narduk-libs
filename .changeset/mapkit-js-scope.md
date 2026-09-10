---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/narduk-mapkit-nuxt': patch
---

Add the required `mapkit_js` scope to dynamically signed MapKit JS tokens so
Apple accepts the token at its JavaScript bootstrap endpoint.
