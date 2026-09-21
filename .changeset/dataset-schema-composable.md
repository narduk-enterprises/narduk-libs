---
'@narduk-enterprises/narduk-seo': minor
---

Add `useDatasetSchema` for schema.org `Dataset` JSON-LD.

Pages that publish a data series — a buoy station, a gauge, a catalog of
readings — had no way to describe it as a dataset, so Google Dataset Search and
the AI-discovery surfaces that read the same markup saw only a `WebPage`.

`useDatasetSchema({ name, variableMeasured, temporalCoverage, distribution, license, creator, ... })`
emits a `Dataset` node in the established shape of the other schema helpers in
this package: auto-imported, `MaybeRefOrGetter` input, and every optional field
omitted rather than emitted empty.

`variableMeasured` takes either a bare string or
`{ name, unitText, unitCode, minValue, maxValue, description }` and becomes
`PropertyValue` nodes; `distribution` becomes `DataDownload` nodes and drops
entries with no `contentUrl`; `creator` defaults to an `Organization` and
accepts `Person`; and `includedInDataCatalogUrl` becomes a `DataCatalog` node.
