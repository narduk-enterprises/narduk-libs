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

The warning now logs once per distinct unknown-key set per process, remembering
at most 256 sets. Past that cap it emits exactly one final
`list_query_unknown_keys_suppressed` notice and stops — it does not clear and
resume — so a caller varying the throwaway key every request cannot reproduce
one-log-line-per-request by pushing the memorized set past its limit. Memory
stays bounded at 256 remembered sets, and total log lines are now at most 257
per isolate, regardless of request volume. Only the key _names_ were ever
logged, never values, so this was a log-volume issue, not an injection or
leakage one.
