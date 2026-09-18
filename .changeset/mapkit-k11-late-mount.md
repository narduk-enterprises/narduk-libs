---
'@narduk-enterprises/narduk-mapkit': patch
---

Fix a blank map after client-side navigation: a late-mounted `<AppMapKit>` never
built its `mapkit.Map` because the init watcher fired once while `ready` was
already true and the canvas ref was still null. Init now waits for both MapKit
JS and the mounted container, whichever arrives last.
