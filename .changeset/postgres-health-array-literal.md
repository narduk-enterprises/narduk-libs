---
'@narduk-enterprises/narduk-postgres': patch
---

Fix `checkHealth`'s extension lookup over an unprepared (`prepare: false`)
connection -- the Workers/Hyperdrive path `withHyperdriveConnection` uses.
Binding the required-extensions list as a raw array parameter
(`ANY($1::text[])`) is not portable there: the driver cannot type-infer an
unprepared parameter and has been observed to serialize a raw array as bare
comma-joined text instead of a `{...}` array literal, which PostgreSQL rejects
with `22P02 malformed array literal`. Every healthy database behind Hyperdrive
reported `ok: false`, with every required extension listed as missing, even
though `SELECT 1` succeeded first. The lookup now binds a single joined string
and builds the array server-side (`ANY(string_to_array($1::text, ','))`), which
works identically on a prepared (direct/Node) connection.

Also fixes `connected`: a statement error raised after `SELECT 1` succeeds (such
as the bug above, or any other extension-lookup failure) now reports
`connected: true` -- a reachable-but-wrong database, the distinction the module
exists to draw -- instead of always reporting `connected: false` on any error
regardless of whether the connection itself was ever established.

`./testing`'s `ProtocolFake` gained a `{ prepare: false }` option that models
this failure mode: it rejects a raw array parameter, so a unit test can see this
class of bug without a database.

Closes narduk-libs#304.
