---
'@narduk-enterprises/narduk-shell': minor
---

Add `useCollection<T>()` and `NePager` — the suite's paged-list state machine
and the control at the foot of the list (components backlog item 11,
narduk-libs#258).

`useCollection()` consumes the `@narduk-enterprises/narduk-platform/list-query`
contract rather than restating it, and enforces five rules every list in the
estate had solved separately or not at all: one request in flight with coalesced
triggers and the superseded request aborted; a response whose scope no longer
matches discarded rather than rendered; a debounced `q`; `page` reset to 1
whenever `q`, a filter, `sort` or `limit` changes; and `page` clamped from the
response that landed, so a delete emptying the last page costs exactly one extra
request to reach the new last page. `syncQuery: true` mirrors `page`/`q`/`sort`
in the route query, reading the URL before the first request and omitting
defaults so page one has one canonical URL. Each rule is pinned by a test that
asserts a request count.

`NePager` wraps `UPagination`, owns no state, and can write back only the page
number. With `:to` every control renders as a real `<a href>`, proven in the
server output against the real `UPagination`. A route that does not count
(`total: null`) gets Previous/Next instead of invented page numbers.

`vue-router` becomes a declared peer (`^4.5.0 || ^5.0.0`, matching Nuxt UI's own
range): `syncQuery` calls `useRoute()`/`useRouter()` directly and `:to` resolves
through the router.
