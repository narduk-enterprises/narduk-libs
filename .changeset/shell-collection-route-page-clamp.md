---
'@narduk-enterprises/narduk-shell': patch
---

Fix `useCollection({ syncQuery: true })`'s route-sync path skipping the
`pageCount` clamp `setPage()` applies. A stale or hand-edited URL — a Back into
an older history entry, say — could send an offset the client already knows is
out of range. Both paths now share one `clampToKnownPageCount()` helper (#288).

Pure bug fix, no public API change.
