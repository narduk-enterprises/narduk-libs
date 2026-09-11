# @narduk-enterprises/narduk-core

Core UI, worker runtime, and shared utilities.

First-class Nuxt package source in this workspace.

Generic shell primitives such as `AppBreadcrumbs` live here; AI runtime and
admin surfaces now belong to `@narduk-enterprises/narduk-ai` in
`packages/modules/narduk-ai/`.

> [!NOTE] Public SEO and Schema.org capabilities have been moved to
> `@narduk-enterprises/narduk-seo` in `packages/modules/narduk-seo/`. Internal
> SPA apps and operator consoles can use only `@narduk-enterprises/narduk-core`
> without loading public formatting dependencies. Public websites should
> explicitly register the SEO package and use `useSeo(...)` for proper
> structured metadata.

Nitro OpenAPI generation is enabled here for all downstream apps. By default,
production builds prerender `/_openapi.json`, while the Scalar and Swagger UI
routes stay disabled unless an app opts into `nitro.openAPI.ui`. Set
`NUXT_OPENAPI_PRODUCTION=runtime` to serve the spec dynamically or
`NUXT_OPENAPI_PRODUCTION=false` to disable the production route entirely.

The core security headers keep browser geolocation disabled by default. Apps
that intentionally need user-location prompts can set
`NUXT_PUBLIC_ALLOW_GEOLOCATION=true` to emit
`Permissions-Policy: geolocation=(self)` while leaving camera and microphone
blocked.

## Media security policy

Media stays restricted to the application origin by default. Set
`runtimeConfig.public.cspMediaSrc` (or `CSP_MEDIA_SRC` at build time /
`NUXT_PUBLIC_CSP_MEDIA_SRC` at runtime) to a comma-separated list of additional
sources, such as `blob:,https://media.example.com`. Browser MSE players
typically need `blob:` here and the media origin in `cspConnectSrc` for manifest
and segment fetches; native HLS needs the media origin in `cspMediaSrc`. These
options extend only their named directives and leave scripts, frames, and
workers unchanged.

## Database alias contract

Core-owned server code uses two private Nuxt aliases. `#narduk-core/schema`
selects the D1 or PostgreSQL core schema according to `NUXT_DATABASE_BACKEND`,
while `#narduk-core/postgres-runtime` selects the real PostgreSQL adapter or the
D1-safe stub. Capability packages that need core tables may use
`#narduk-core/schema` after registering the core Nuxt module.

Application code must use its own `#narduk-db` dialect selector instead. These
private aliases do not replace Nuxt's native `#server/*` paths, and the former
template-era database aliases are not registered.

## List routes: parseListQuery + listResponse

Every list route parses one query shape and answers in one response shape. The
zod schemas live in `@narduk-enterprises/narduk-platform/list-query`; the two
server helpers are auto-imported from `server/utils/listQuery` (or imported
explicitly from `@narduk-enterprises/narduk-core/server/utils/listQuery`).

`parseListQuery(event, options)` validates the event's query string and returns
the parsed query. `options`:

| Option           | Meaning                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `sortable`       | Allowlisted sort keys. The wire form is `'<key>:<asc\|desc>'`.                                      |
| `filters`        | A zod object whose keys are the route's allowlisted filters. Its keys sit flat on the query string. |
| `maxLimit`       | The route's page ceiling. A larger `limit` is **clamped**, not rejected.                            |
| `mode`           | `'offset'` (default) or `'cursor'`.                                                                 |
| `defaultLimit`   | Page size when the caller sends none (default 25, clamped to `maxLimit`).                           |
| `defaultSort`    | Sort applied when the caller sends none.                                                            |
| `maxQueryLength` | Longest accepted `q`, after trimming (default 200).                                                 |
| `searchable`     | Whether the route applies `q` (default `true`). `false` rejects a non-empty `q`.                    |

The schema is `.strict()`: an unknown query key is **rejected**, not silently
stripped, so a typo'd or renamed parameter fails loudly instead of quietly
returning the wrong page. A route with no free-text search sets
`searchable: false` for the same reason — an accepted-and-ignored `q` reads to
the caller as a narrowed page it never got. Any invalid query throws a 400
(never a 500) whose `data` is a stable payload —
`{ code: 'invalid_list_query', fields, unknownKeys, issues }` — naming the
offending keys.

`listResponse(items, { query, total, nextCursor })` returns
`{ items, total, limit, sort, q }` plus `offset` (offset mode) or `nextCursor`
(cursor mode, `null` when the page exhausted the collection). `total` is `null`
when the route deliberately does not count, which keeps a page to one statement.

```ts
// server/api/runners/index.get.ts
export default defineEventHandler(async (event) => {
  const query = parseListQuery(event, {
    filters: z.object({ status: z.enum(['idle', 'busy']).optional() }),
    maxLimit: 100,
    sortable: ['createdAt', 'name'],
    defaultSort: 'createdAt:desc',
  })

  const where = query.filters.status
    ? eq(runners.status, query.filters.status)
    : undefined
  const order =
    query.sort?.direction === 'asc'
      ? asc(runners.createdAt)
      : desc(runners.createdAt)

  // One page query plus one count query, whatever the page size.
  const [total, items] = await Promise.all([
    getDatabaseRow(
      db
        .select({ count: sql`count(*)` })
        .from(runners)
        .where(where),
    ),
    getDatabaseRows(
      db
        .select()
        .from(runners)
        .where(where)
        .orderBy(order)
        .limit(query.limit)
        .offset(query.offset),
    ),
  ])

  return listResponse(items, { query, total: Number(total?.count ?? 0) })
})
```

`GET /api/runners?limit=9999&sort=name:asc&status=idle` answers
`{ items, total, limit: 100, offset: 0, sort: 'name:asc', q: null }`;
`?statuss=idle` answers 400.

A list route may issue at most two SQL statements per request (the
`LIST_QUERY_STATEMENT_CEILING`): one page `SELECT`, plus one `COUNT(*)` when
`total` is a number. Set `total: null` to stay at one statement.

### Worked example: stonx `server/utils/query.ts`

stonx is the first pilot (plan §3). Today it has three list shapes in
`server/utils/query.ts` and the routes that call it:

1. `getPaginationParams` / `buildPaginatedResponse` —
   `{ data, pagination: { total, page, limit, totalPages, hasNextPage, hasPreviousPage } }`
   — used by `admin/games`, `me/positions`, `leaderboard`.
2. A one-off zod envelope in `admin/stats-detailed.get.ts`.
3. `{ results, count, totalPages, page, status }` in `market/screeners.get.ts`,
   whose `limit` caps at **500** (everywhere else that enforces a cap uses 100).
   `watchlist/index.get.ts` and `market/big-movers.get.ts` have no page/limit
   at all.

Those three become one `parseListQuery` + `listResponse` call. The screener
keeps its 500 cap via `maxLimit`; watchlist and big-movers gain a limit by
passing a smaller `defaultLimit`:

```ts
// stonx server/api/market/screeners.get.ts — after the migration
const query = parseListQuery(event, {
  filters: z.object({
    exchange: z.string().optional(),
    sectors: z.string().optional(),
  }),
  maxLimit: 500, // the screener's existing ceiling; not a new default
  sortable: ['symbol', 'marketCap', 'changePercent'],
  defaultSort: 'symbol:asc',
})

return listResponse(rows, { query, total })
// { items, total, limit, offset, sort, q }
```

`parseSortParam` in today's `query.ts` silently falls back to the default on
an unknown field; the contract **rejects** that key instead — the bug class
stonx#208 named. The stonx adoption PR is deferred from this narduk-libs PR.
