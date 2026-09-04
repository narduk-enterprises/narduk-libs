# Agent notes for GeoGridWeb

Web twin of GeoGridKit (`@narduk-enterprises/geogrid-web`). Sibling of
`GeoGridKit` and `narduk-mapkit` under `narduk-enterprises` — not
MapKit-specific.

The `narduk-geo` GitHub organization and npm scope are retired. Do not restore
either one. Current cross-cutting ownership:

- Portfolio and repository index: **narduk-enterprises/company-hq**
- Data platform and geo pipeline topology: **narduk-enterprises/narduk-data**

Extract source: `earthdata-viewer` `app/playback/temporal{Raster,WebGL,Canvas}.ts`.
Consumers: earthdata-viewer (temporal overlay), future farm-analytics / web plotter.
