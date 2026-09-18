---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

AppLightbox gains optional thumbnail rails (0–2 labelled rails, each with its
own keyboard axis) and a `side` slot for per-picture details. `AppImage` wraps
remote pictures with loading and failed states. `AppSnapStrip` is a horizontal
scroll-snap strip with an en-dash position readout (narduk-libs#529).
`create-narduk-app` is a companion patch so the generator pin moves with the
core minor.
