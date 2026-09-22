---
'@narduk-enterprises/narduk-core': minor
---

Adds `useCurrentLocation()`, a consent-first "near me" location read (#385).
Nothing is read until `locate()` is called from a user gesture. Each call is one
`getCurrentPosition`: it never watches, polls or reports a coordinate, and
server rendering is a no-op.

It keeps four failure outcomes apart. `denied` means the person refused.
`blocked` means the page's own Permissions-Policy forbids geolocation; Chromium
reports that as a denial, and the composable tells the two apart. `unavailable`
means no position could be had, and `timeout` means none arrived in time.

Fixes `NUXT_PUBLIC_ALLOW_GEOLOCATION` having no effect with the
`security.headers` preset on. Before this change only the legacy middleware read
it, so the app reported `allowGeolocation: true` and still sent
`geolocation=()`. The preset now grants `geolocation=(self)` from it at build
time. An explicit `permissionsPolicy.geolocation` still wins.
