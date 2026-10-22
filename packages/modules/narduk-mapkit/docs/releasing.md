# Releasing MapKit

`@narduk-enterprises/narduk-mapkit` releases through the repository-wide
changeset flow described in
[`docs/package-releases.md`](../../../../docs/package-releases.md). There is no
tag-triggered publish: `release.yml` runs on `workflow_dispatch` and after CI
passes on `main`.

The Nuxt adapter is the package's `./nuxt` export.
`@narduk-enterprises/narduk-mapkit-nuxt` is frozen and is not published anymore;
do not tag or publish it.

The package `quality` script runs format, lint, typecheck and tests only.
