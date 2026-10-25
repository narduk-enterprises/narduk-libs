---
'@narduk-enterprises/narduk-timeseries': minor
---

Rollups no longer count import-overlay rows (`quality = 3`, mybo-at-v2 D-152).
New migration `0008_rollups_exclude_import_overlay.sql` drops and recreates the
1m → 15m → 1h → 1d continuous-aggregate ladder with the 1m filter
`WHERE installation_role = 0 AND quality <> 3`, re-adds 0002's refresh policies
and re-issues 0003's SELECT grants on the views. The time-weighted refresh's raw
read excludes the same rows, and `timeWeightedBuckets` skips a reading tagged
`quality: IMPORT_OVERLAY_QUALITY` (new export, 3). Quality 0, 1 (stale) and 2
(suspect) still count everywhere.

Applying 0008 empties the rollup views: the policies rebuild their 7-day (30-day
at 1d) windows, and older buckets need an `ops` refresh bottom-up with
`refreshRollupsStatements`. A deployment that sweeps raw loses rollup history
older than its raw window; see the README section "Import-overlay rows
(quality 3) live in raw only".
`telemetry_numeric_tw` is untouched by 0008: re-run `refreshTimeWeighted` over
the tagged range to drop the overlay from rows refreshed before the tag.
