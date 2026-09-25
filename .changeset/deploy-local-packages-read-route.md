---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`deploy-local` now names `GH_PACKAGES_READ`'s registered route (nvault `github/prd/narduk-enterprises-packages-read`) when that key is missing, rather than sending the operator to the app's config, which holds no copy of it. The README shows the combined `nvault run` invocation (#333).
