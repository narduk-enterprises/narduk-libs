---
'@narduk-enterprises/create-narduk-app': patch
---

Release alongside the `narduk-core` minor bump (`readApproximateLocation`) so
the generator's `PACKAGE_VERSIONS` pin for that package ships at the version it
is synced to. `create-narduk-app` writes that pin verbatim into every scaffolded
app's `package.json`, so a release that moves the pinned package without
republishing the generator leaves new apps pinned to a version the generator no
longer names. No behavior change in the generator itself.
