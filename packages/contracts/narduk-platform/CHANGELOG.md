# @narduk-enterprises/narduk-platform

## 2.1.1

### Patch Changes

- 5ac629e: The package's `volta.node` pin moves from 22.22.3 to 24.21.0, the
  Node the workspace root and CI run (narduk-libs#647). No runtime change: the
  pin only selects the Node that Volta runs for commands inside the package
  directory. It now matches the ABI of the native modules that the root install
  builds.

## 2.1.0

### Minor Changes

- 0f45d4b: Add the shared list-query contract and its h3 helpers, so every list
  route in the estate parses the same query shape and answers with the same
  response shape.

  **narduk-platform** gains a new `./list-query` subpath (also re-exported from
  the package root, matching the package's convention):

  - `listQuerySchema({ sortable, filters, maxLimit, mode, defaultLimit, defaultSort, maxQueryLength, searchable, strict })`
    builds a zod object accepting `limit` (positive integer, clamped to
    `maxLimit`), `sort` as `'<key>:<asc|desc>'` with the key drawn from
    `sortable`, `q` (trimmed, length-bounded, `null` when blank), the caller's
    own `filters` object flat on the query string, and either `offset` (integer
    ≥ 0) in `mode: 'offset'` or `cursor` (opaque non-empty string) in
    `mode: 'cursor'`.
  - `LIST_QUERY_STATEMENT_CEILING` is 2 (one page `SELECT` plus one optional
    `COUNT(*)`). The schema cannot count SQL; route tests that wrap the D1
    binding enforce the ceiling.
  - An unknown key is never silently **stripped**. A typo'd or renamed parameter
    that reads as "no filter" is the riverstatus bug class this contract exists
    to close: the page silently came back unfiltered. By default the key is
    **tolerated**: the request still succeeds and the ignored key comes back on
    `unknownKeys` (see the tolerate-and-warn amendment below); pass
    `strict: true` to reject it outright with a 400.
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
    through the narduk-platform schema, and on failure (a bad value for a
    declared key, or any unknown key when `strict: true`) throws `createError`
    with **400** (never a 500) and a stable machine-readable `data` payload —
    `{ code: 'invalid_list_query', fields, issues, unknownKeys }` — naming the
    offending keys and fields. When an unknown key is tolerated instead, it logs
    one structured warning per request naming it.
  - `listResponse(items, { total, query, nextCursor })` builds the matching
    `ListResponse`, echoing the query's `limit`, `sort` and `q`.
  - Both are documented under "List routes: parseListQuery + listResponse" in
    the narduk-core README and in narduk-platform's new README.

  **Amendment (tolerate-and-warn, Logan 2026-09-11):** an unknown query key
  shipping as a rejected 400 by default was compatibility-narrowing for live
  fleet callers, not an approved breaking change. `strict` now defaults to
  `false` — an unknown key is tolerated and warned on, not rejected — for one
  release; the next major flips the default to `true`. See
  `.changeset/list-query-tolerate-unknown-keys.md`.

  Refs narduk-libs#247.

- fdb9c15: Tolerate an unknown list-query key for one release instead of
  rejecting it with a 400 (Logan, 2026-09-11). `.strict()` unknown-key rejection
  shipped as a `minor` in the list-query contract (narduk-libs#257) but is
  compatibility-narrowing for live fleet callers that were sending an extra
  query parameter which used to be silently ignored — that is not an approved
  breaking change, so this restores the previously-accepted behaviour for one
  release with a warning attached, and keeps the stricter behaviour reachable
  for a route that wants it today.

  **narduk-platform** (`./list-query`):

  - `listQuerySchema()` gains a `strict` option, default `false`. With
    `strict: false` (the default) an unknown query key no longer fails parsing:
    the request still succeeds with the known keys parsed exactly as before, and
    the caller-sent keys this route does not declare come back on the parsed
    result's new `unknownKeys: string[]` field (`[]` when there are none, or
    when `strict: true` rejected them before this field would ever be produced).
    `strict: true` restores exactly today's `.strict()` behaviour — a 400 naming
    the offending keys.
  - The next major flips the `strict` default to `true`, so a route that wants
    today's rejection behaviour to survive that flip unchanged should pass
    `strict: true` now rather than relying on the current default.

  **narduk-core** (`server/utils/listQuery`):

  - `parseListQuery` forwards `strict` to the schema unchanged.
  - When an unknown key is tolerated, `parseListQuery` logs one structured
    `warn` per request through narduk-logging (`useLogger(event)`, not a
    dev-only `console.warn`, so it reaches a fleet operator's normal log
    aggregation in production) naming every ignored key and stating they will be
    rejected with a 400 once `strict` defaults to `true` in the next major. The
    warning never fires when there are no unknown keys. That warning call is
    also wrapped so a logging failure can never turn a tolerated request into
    a 500.
  - `server/utils/logger.ts` no longer statically imports `nitropack/runtime`.
    That package's entry point is a barrel file that also re-exports an internal
    module referencing a build-time-only Nitro virtual specifier, so the static
    import made any module reaching `logger.ts` — including, transitively,
    `listQuery.ts` once it started calling `useLogger` — unloadable outside a
    booted Nitro server, breaking narduk-ai's and narduk-auth's plain-vitest
    list-route unit tests. `useRuntimeConfig` is now resolved lazily via a
    cached dynamic import: behaviour inside a real Nitro server is unchanged,
    and every existing caller already treated "runtime config unavailable" as an
    expected, handled case.

  **Compatibility.** This is a fix to the `.strict()` `minor` shipped in
  narduk-libs#257/#282, not a new breaking change: a caller relying on today's
  400-on-unknown-key behaviour keeps it by passing `strict: true`; every other
  caller regains the pre-`.strict()` tolerance. narduk-auth's
  `GET /api/admin/users` and `GET /api/notifications`, and narduk-ai's
  `GET /api/admin/system-prompts`, all use the default (non-strict) mode, so an
  unknown query key sent to any of them now answers 200 with a logged warning
  again, matching `.changeset/list-routes-migrated.md`'s "previously-accepted
  query keys stay accepted" framing, which this text now restates accurately
  instead of contradicting.

  Refs narduk-libs#247, narduk-libs#257.

## 2.0.0

### Major Changes

- 7848187: Remove template composition and Command-only contracts from
  `narduk-platform`, retire core PWA and control-plane behavior, and source the
  SEO network directory from the independent catalog origin.
