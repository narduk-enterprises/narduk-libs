---
'@narduk-enterprises/narduk-logging': minor
---

Add the statement / round-trip counter contract from narduk-libs#325.
`QueryCounter` is driver-agnostic: a data-binding wrapper calls
`recordRoundTrip(statements = 1)` once per call into the binding
(`statements.length` for a D1 batch). Every `RequestTiming` owns one as
`timing.counter`; on h3, `useRequestCounter(event)` returns the same object.
Once anything is counted, exposed phases render their own delta
(`desc="1 stmt / 1 rt"`) and `total` renders the cumulative counts, and the
"Request completed" / "Slow route" records carry `statements` and `roundTrips`.
A request that counts nothing renders and logs exactly what it did before. Also
exported: `formatQueryCounts` and the `QueryCounts` type.
