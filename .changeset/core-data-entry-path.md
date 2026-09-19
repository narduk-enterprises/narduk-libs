---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

`createNardukDataClient` can now read a release's secondary artifacts, the ones
the manifest lists in `artifacts[]` beside the primary `artifact`. Set the new
`NardukDataProduct.entryPath` option to a release-relative path, for example
`consumer/lakes/texas/canyon-lake/history-1y.json`.

- The path may have several segments, each of which must be a plain name.
- The entry is checked against its own listed SHA-256, with the usual timeout,
  retry, single-flight, memo, stale-if-error and freshness handling.
- A release that does not list the entry fails with the new `NardukDataError`
  reason `'missing'`, so consumers can answer "not published" rather than
  reporting an outage. It never falls back to the primary artifact.

Reads without `entryPath` are unchanged (#552).
