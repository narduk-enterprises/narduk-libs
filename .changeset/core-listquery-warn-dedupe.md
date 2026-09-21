---
'@narduk-enterprises/narduk-core': patch
---

Dedupe `parseListQuery`'s unknown-query-key warning per distinct key set instead
of logging once per request.

The tolerate-and-warn path (#257, shipped in #283) logged one structured `warn`
line every time a request carried an unknown list-query key, with no dedupe,
counter, or cache. Two of the three routes it covers have no rate limit ahead of
it, so an ordinary authenticated session could force unbounded log volume — and
the per-request hot-path cost that comes with it — just by appending one
throwaway query parameter to every request (e.g.
`GET /api/notifications?limit=20&x=1`).

The warning now logs once per distinct unknown-key set per process, capped at
256 remembered sets with clear-on-overflow (the same shape `format.ts`'s
`MAX_CACHE_ENTRIES` cache uses in `@narduk-enterprises/narduk-shell`) so a
caller varying the throwaway key every request pays a rebuild instead of growing
the set without bound. Only the key _names_ were ever logged, never values, so
this was a log-volume issue, not an injection or leakage one.
