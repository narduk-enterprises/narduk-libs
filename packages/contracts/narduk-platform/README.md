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

Unknown keys are **rejected**, never silently stripped: a typo'd or renamed
parameter must fail loudly rather than read as "no filter" and return the wrong
page. `limit`, `offset` and the filters are coerced from their query-string
form; `q` is trimmed and becomes `null` when blank.

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
