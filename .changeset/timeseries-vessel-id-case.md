---
'@narduk-enterprises/narduk-timeseries': patch
---

`resolveSeries`, `writeNumeric` and the series cache now match a `vesselId` in
any spelling Postgres accepts for a uuid (narduk-libs#940). The resolve
statement's `RETURNING` answers in lowercase canonical form, and the descriptor
lookup used the caller's string as given. So an uppercase `UUID().uuidString`
from Swift threw `SERIES_UNRESOLVED` on every batch after the upsert had run,
and none of its points were written. A batch that spelled one vessel two ways
also sent two upsert rows for one `(vessel_id, path)`. Series keys now use the
canonical form.
