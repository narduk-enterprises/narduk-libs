# Agent notes for GeoGridWeb

Web twin of GeoGridKit (`@narduk-geo/geogrid-web`). Sibling of `GeoGridKit` in the
`narduk-geo` org — not MapKit-specific (see `narduk-mapkit` for that).

Cross-cutting infra & topology: **narduk-geo/geo-infrastructure**

- Repo index: https://github.com/narduk-geo/geo-infrastructure/blob/main/docs/repo-index.md
- Topology: https://github.com/narduk-geo/geo-infrastructure/blob/main/docs/topology.md

Extract source: `earthdata-viewer` `app/playback/temporal{Raster,WebGL,Canvas}.ts`.
Consumers: earthdata-viewer (temporal overlay), future farm-analytics / web plotter.
