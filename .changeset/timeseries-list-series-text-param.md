---
'@narduk-enterprises/narduk-timeseries': patch
---

`listSeries` binds its path filter as text and casts it to jsonb in SQL. Bound as jsonb, postgres.js (the Worker driver behind Hyperdrive) JSON-encoded the already-serialized filter a second time and every filtered lookup failed with "cannot extract elements from a scalar".
