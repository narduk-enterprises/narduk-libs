---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `useLiveProduct(refresh, { intervalMs, updatedAt? })`, the recommended replacement for a bare `useIntervalRefresh` when the refreshed data is user-visible live content (narduk-libs#374). Polling pauses while the page is hidden and refreshes at once on return when a poll fell due; overlapping refreshes share the run in flight (`useInFlightTracker`), and `refresh()` never rejects, keeping a failure in `error`. Its `updatedAgo` ("3 minutes ago") reads `formatRelative` against `useSsrNow`, and nothing runs until mount, so neither the label nor `pending` can mismatch the server render. It takes any refresh callback and fetches nothing itself.
