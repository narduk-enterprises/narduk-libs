---
'@narduk-enterprises/narduk-platform': minor
'@narduk-enterprises/narduk-core': minor
---

Add the shared list-query contract and its h3 helpers, so every list route in
the estate parses the same query shape and answers with the same response shape.

**narduk-platform** gains a new `./list-query` subpath (also re-exported from
the package root, matching the package's convention):

- `listQuerySchema({ sortable, filters, maxLimit, mode, defaultLimit, defaultSort, maxQueryLength, searchable })`
  builds a `.strict()` zod object accepting `limit` (positive integer, clamped
  to `maxLimit`), `sort` as `'<key>:<asc|desc>'` with the key drawn from
  `sortable`, `q` (trimmed, length-bounded, `null` when blank), the caller's own
  `filters` object flat on the query string, and either `offset` (integer ≥ 0)
  in `mode: 'offset'` or `cursor` (opaque non-empty string) in `mode: 'cursor'`.
- `LIST_QUERY_STATEMENT_CEILING` is 2 (one page `SELECT` plus one optional
  `COUNT(*)`). The schema cannot count SQL; route tests that wrap the D1 binding
  enforce the ceiling.
- Unknown keys are **rejected**, never silently stripped. A typo'd or renamed
  parameter that reads as "no filter" is the riverstatus bug class this contract
  exists to close: the page silently came back unfiltered.
- `searchable: false` closes the same hole from the other side: a route that
  does not implement free-text search rejects a non-empty `q` instead of
  accepting it and quietly returning an unnarrowed page.
- `ListQuery<TFilters, TKey>` and `ListResponse<TItem, TMode>` —
  `{ items, total: number | null, limit, sort, q }` plus `offset` or
  `nextCursor` — with `formatListSort()` rendering the parsed sort back to its
  wire form.
- `zod` is now a runtime dependency of narduk-platform, at the same `^4.4.3`
  range narduk-core uses.

**narduk-core** gains `server/utils/listQuery`:

- `parseListQuery(event, options)` reads the h3 event's query, validates it
  through the narduk-platform schema, and on failure throws `createError` with
  **400** (never a 500) and a stable machine-readable `data` payload —
  `{ code: 'invalid_list_query', fields, issues, unknownKeys }` — naming the
  offending keys and fields.
- `listResponse(items, { total, query, nextCursor })` builds the matching
  `ListResponse`, echoing the query's `limit`, `sort` and `q`.
- Both are documented under "List routes: parseListQuery + listResponse" in the
  narduk-core README and in narduk-platform's new README.

Refs narduk-libs#247.
