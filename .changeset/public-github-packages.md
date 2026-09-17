---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/geogrid-web': patch
'@narduk-enterprises/journeys': patch
'@narduk-enterprises/narduk-ai': patch
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/narduk-app': patch
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/narduk-devices': patch
'@narduk-enterprises/narduk-logging': patch
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/narduk-platform': patch
'@narduk-enterprises/narduk-postgres': patch
'@narduk-enterprises/narduk-realtime': patch
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/narduk-shell': patch
'@narduk-enterprises/narduk-tenancy': patch
'@narduk-enterprises/narduk-testkit': patch
'@narduk-enterprises/narduk-timeseries': patch
'@narduk-enterprises/narduk-ui': patch
'@narduk-enterprises/narduk-uploads': patch
'@narduk-enterprises/status-runtime': patch
---

Publish the narduk-libs GitHub Packages as public. The live package visibility
was flipped on 2026-09-17; this keeps `publishConfig.access` and Changesets
aligned so the next release does not republish as restricted.
`narduk-mapkit-nuxt` stays Changesets-ignored (2.0.x freeze) and is not in this
release. GitHub's npm registry still requires a packages-scoped token to
install, even for public packages.
