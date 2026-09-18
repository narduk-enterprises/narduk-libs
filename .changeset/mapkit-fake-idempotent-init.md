---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

`./testing` fake: a second `mapkit.init()` while the first token exchange is
pending, or after it succeeded, is now an idempotent no-op instead of throwing
`FakeMapKitNotImplemented` (K-7, narduk-libs#522). No new token is requested,
the first call's options stand, and the call is logged as `init` with detail
`ignored`. A second `init()` after a failed exchange still runs a new exchange,
so `retry()` stays testable. New conformance tests pin the rect camera (K-5:
`visibleMapRect`, `setVisibleMapRectAnimated`, `MapRect` / `MapPoint` /
`MapSize`, `Map.MapTypes`) against the Web-Mercator maths buoys' shim used, in
vitest and through `fakeMapKitInitScript()`, so buoys can delete both shims.
