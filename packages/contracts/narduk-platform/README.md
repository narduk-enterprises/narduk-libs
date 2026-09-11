# @narduk-enterprises/narduk-platform

Neutral contracts shared by independent Narduk apps: environment and onboarding
metadata, the package registry, provider-console descriptions, and the shared
list-query contract. The package describes shapes — it never mutates a provider,
and it never reaches for a server runtime, so a client and a server can import
the same schema.

Each contract has its own explicit subpath export (`./env-catalog`,
`./list-query`, `./package-registry`, `./provision-env-contract`,
`./provision-metadata`, `./provider-console`), and the package root re-exports
all of them.

## List routes: parseListQuery + listResponse

`./list-query` owns the query shape every list route in the estate parses, and
the response shape every one of them answers with. The h3 helpers that bind it
to a route — `parseListQuery` and `listResponse` — live in narduk-core's server
utils; this package owns the schema and the types.

`listQuerySchema(options)` builds a `.strict()` zod object:

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

Unknown keys are **rejected**, never silently stripped: a typo'd or renamed
parameter must fail loudly rather than read as "no filter" and return the wrong
page. `limit`, `offset` and the filters are coerced from their query-string
form; `q` is trimmed and becomes `null` when blank. A route that does not
implement free-text search sets `searchable: false` so that `?q=…` fails for the
same reason: an accepted-and-ignored filter reads to the caller as a narrowed
page it never got.

```ts
import {
  listQuerySchema,
  type ListResponse,
} from '@narduk-enterprises/narduk-platform/list-query'
import { z } from 'zod'

const schema = listQuerySchema({
  filters: z.object({ status: z.enum(['idle', 'busy']).optional() }),
  maxLimit: 100,
  sortable: ['createdAt', 'name'],
  defaultSort: 'createdAt:desc',
})

schema.parse({ limit: '9999', sort: 'name:asc', status: 'idle' })
// { filters: { status: 'idle' }, limit: 100, mode: 'offset', offset: 0,
//   q: null, sort: { key: 'name', direction: 'asc' } }

schema.safeParse({ statuss: 'idle' }).success // false
```

The parsed query carries `sort` as a `{ key, direction }` pair for the server to
apply; `formatListSort()` renders it back to its wire form, which is what
`ListResponse<T>` echoes:

```ts
type Runners = ListResponse<Runner>
// { items: Runner[]; total: number | null; limit: number; offset: number
//   sort: string | null; q: string | null }
```

`ListResponse<T, 'cursor'>` replaces `offset` with `nextCursor`, `null` when the
page exhausted the collection. `total` is `number | null`: `null` says the route
deliberately does not count, which keeps a page to a single statement.

`LIST_QUERY_STATEMENT_CEILING` is **2**: one page `SELECT`, plus one `COUNT(*)`
when `total` is a number. The schema cannot count statements — it never talks to
a database — so the constant is the contract, and route tests that wrap the D1
binding enforce it.

### Worked example: stonx `server/utils/query.ts`

stonx is the first pilot (plan §3). Today it has three list shapes:

1. `getPaginationParams` / `buildPaginatedResponse` in `server/utils/query.ts` —
   `{ data, pagination: { total, page, limit, totalPages, hasNextPage, hasPreviousPage } }`
   — used by `admin/games`, `me/positions`, `leaderboard`.
2. A one-off zod envelope in `admin/stats-detailed.get.ts`.
3. `{ results, count, totalPages, page, status }` in `market/screeners.get.ts`,
   whose `limit` caps at **500**. `watchlist` and `big-movers` have no
   page/limit.

Those three become one `listQuerySchema` (and, on the server, `parseListQuery` +
`listResponse`). The screener keeps its 500 cap via `maxLimit`; watchlist and
big-movers gain a limit:

```ts
const schema = listQuerySchema({
  filters: z.object({
    exchange: z.string().optional(),
    sectors: z.string().optional(),
  }),
  maxLimit: 500, // screener; other stonx lists pass 100
  sortable: ['symbol', 'marketCap', 'changePercent'],
  defaultSort: 'symbol:asc',
})
```

The stonx adoption PR is deferred from this narduk-libs PR.
