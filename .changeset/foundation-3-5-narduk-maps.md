---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

foundation:check 3.5 counts `@narduk-enterprises/narduk-maps` as the estate maps package, so an app on `narduk-maps/gl` that imports its `maplibre-gl` peer (for `setWorkerUrl`) passes instead of failing as a direct map-library import.

create-narduk-app picks up the new narduk-app-tools pin.
