---
'@narduk-enterprises/create-narduk-app': patch
---

Release alongside the `narduk-mapkit` / `narduk-mapkit-nuxt` patch bumps so the
generator's `PACKAGE_VERSIONS` pins for those two packages ship at the versions
they are synced to. `create-narduk-app` writes those pins verbatim into every
scaffolded app's `package.json`, so a release that moves the pinned packages
without republishing the generator leaves new apps pinned to a version the
generator no longer names. No behaviour change in the generator itself.
