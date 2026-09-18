---
'@narduk-enterprises/narduk-timeseries': patch
---

Bind no bare JS arrays (narduk-libs#311). `queryRollup`'s series ids and
`applyRetention`'s per-tier vessel batches now bind as one comma-joined text
parameter, split server-side with
`ANY(string_to_array($n::text, ',')::bigint[])` / `::uuid[]`. Under a
Hyperdrive-shaped postgres.js connection (`prepare: false, fetch_types: false`)
the old `ANY($n::type[])` bind failed with `22P02 malformed array literal`,
proven against a real TimescaleDB 17 before and after. The rollup statement
still binds exactly five parameters. `applyRetention` now refuses a vessel id
that is empty or contains a comma (`RETENTION_POLICY_INVALID`), because a comma
would split one id into two array elements and widen the DELETE.
