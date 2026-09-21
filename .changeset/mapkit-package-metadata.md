---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

Point `homepage` and `bugs.url` at narduk-libs instead of the archived
`narduk-enterprises/narduk-mapkit` repo (narduk-libs#540). The Changesets fixed
group is empty and `narduk-mapkit-nuxt` stays ignored, so this patch does not
pull the frozen adapter; the adapter's matching metadata is updated in tree
without a release. `create-narduk-app` is a companion patch so the
generator-owned mapkit pin moves with it.
