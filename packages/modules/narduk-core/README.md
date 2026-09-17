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

## Security headers (`security.headers`)

narduk-core has always set security headers.
`runtime/server/middleware/securityHeaders.ts` is registered by
`addServerScanDir` whenever the module's default `server: true` is in effect, so
every app on this module already serves an enforcing Content-Security-Policy,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and
`X-Content-Type-Options`. What that legacy policy is missing is the part that
makes a CSP worth having:

- no `Strict-Transport-Security` at all;
- `script-src` carries `'unsafe-inline' 'unsafe-eval'`, so an injected inline
  script is allowed by the very header meant to stop it;
- no report-only mode and nowhere for violations to go;
- per-app origins expressible only through `CSP_*_SRC` environment variables;
- no `form-action` and no `upgrade-insecure-requests`.

`security.headers` closes exactly those gaps. It wraps
[`nuxt-security`](https://github.com/Baroshem/nuxt-security) (MIT) rather than
reimplementing a header stack: it is maintained, targets Nuxt 4 through
`@nuxt/kit ^4`, and its runtime imports no Node builtin — `crypto.subtle`,
`crypto.getRandomValues`, `btoa` and `TextEncoder` are all workerd APIs.
nuxt-security is an **optional peer dependency**, so an app that never enables
the preset installs nothing extra.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  nardukCore: {
    security: {
      headers: {
        enabled: true,
        allow: {
          script: ['https://p.nard.uk'],
          connect: ['https://p.nard.uk', 'https://api.iconify.design'],
          img: ['https://tiles.example'],
        },
      },
    },
  },
})
```

### Three modes, and why the default is "change nothing"

| `security.headers`                 | What is served                                                                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| omitted or `false`                 | Exactly today's headers. Upgrading narduk-core changes nothing.                                                                                                                                           |
| `{ enabled: true }`                | The legacy enforcing CSP **keeps being served**, and the strict nonce policy is served beside it as `Content-Security-Policy-Report-Only`. Every other header comes from nuxt-security, and HSTS appears. |
| `{ enabled: true, enforce: true }` | The strict nonce policy becomes the enforcing `Content-Security-Policy` and the legacy one is retired.                                                                                                    |

Both literal readings of "opt-in, report-only first" would have been regressions
here. Making the headers opt-in would strip headers from every app that has them
today, and starting an already-enforcing app in report-only would downgrade a
live policy. Serving the two policies side by side during the soak avoids both:
a browser enforces the `Content-Security-Policy` it is given and only _reports_
on the `-Report-Only` one, so the soak cannot break a page.

### The adoption path

1. **Turn it on.** Set `security.headers.enabled` and deploy. Nothing a user can
   see changes; the app now also serves HSTS and a report-only strict policy.
2. **Soak, and read the violations.** Every violation is logged through
   narduk-logging at `warn` from the report route (`/api/_security/csp-report`
   by default). They go nowhere else — a report body carries the document URI
   and, for an inline violation, a sample of the offending source, and shipping
   that to a third-party collector is a data-egress decision nobody made. Change
   the path with `reportRoute`, or set `reportRoute: false` to serve no route
   and emit no `report-uri`.
3. **Fix what it found**, usually by adding the origin to `allow`. A week of
   real traffic across the routes that matter is a reasonable soak; a quiet
   route proves nothing about a busy one.
4. **Enforce.** Set `enforce: true` and deploy. From here the legacy CSP is gone
   and the strict policy is the one in force.

Prove the deployment at any step with
`narduk-app foundation:check:security-headers --base-url https://your.app`,
which reads the live response headers and reports each one proven, a gap, or
unknown.

### Options

| Option              | Default                                                                        | Notes                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`           | `false`                                                                        | Serve the strict policy at all.                                                                                                                            |
| `enforce`           | `false`                                                                        | Promote it from report-only to enforcing.                                                                                                                  |
| `allow`             | baseline only                                                                  | Extra origins per directive: `script`, `connect`, `img`, `font`, `style`, `frame`, `worker`, `media`. Merged onto the estate baseline, never replacing it. |
| `strictDynamic`     | `true`                                                                         | Keep `'strict-dynamic'` in `script-src`. See the warning below.                                                                                            |
| `hsts`              | 180 days, `includeSubdomains`, no preload                                      | `false` disables it. `preload` is never defaulted on, because submitting to the preload list is irreversible in practice.                                  |
| `frameAncestors`    | `["'none'"]`                                                                   | Also drives the `X-Frame-Options` fallback, which can only express `DENY` and `SAMEORIGIN`.                                                                |
| `referrerPolicy`    | `strict-origin-when-cross-origin`                                              |                                                                                                                                                            |
| `permissionsPolicy` | camera, microphone, geolocation, payment, usb and `interest-cohort` all denied | Merged onto the baseline, so granting one does not restate the rest.                                                                                       |
| `reportRoute`       | `/api/_security/csp-report`                                                    | `false` serves no route and emits no `report-uri`.                                                                                                         |

An app that already sets `CSP_SCRIPT_SRC`, `CSP_CONNECT_SRC`, `CSP_FRAME_SRC`,
`CSP_WORKER_SRC` or `CSP_MEDIA_SRC` keeps those origins: they are folded into
the preset's allowlist, so turning the preset on does not quietly drop them.

> [!WARNING] `'strict-dynamic'` makes a conforming browser **ignore every host**
> in `script-src`, `'self'` included, and trust only scripts created by already-
> trusted script. That is what makes a nonce policy strong, and it is also why a
> script injected into the HTML _after_ Nitro responds — Cloudflare's Web
> Analytics beacon, added by the edge HTML rewriter, is the estate's real case —
> is not covered by listing its host. The report-only soak is where that gets
> decided from evidence; `strictDynamic: false` falls back to host allowlisting.

`style-src` keeps `'unsafe-inline'`. A nonce applies to elements, never to a
`style="…"` attribute, and Vue's scoped-style runtime writes those constantly.
It is the accepted cost of a nonce policy on a Vue app and does not weaken
`script-src`, which is where injection actually lands.

### Proving the nonce

`scripts/prove-nonce.mjs` builds `tests/fixtures/nonce-app` with the strict
policy **enforcing**, serves it on workerd through `wrangler dev --local`, and
asserts that the CSP carries a real per-request nonce, that every script tag
including Nuxt's inline `__NUXT_DATA__` hydration payload is stamped with it,
that two requests get two different nonces, and that Chromium logs no CSP
violation while the page hydrates. It is not part of `test:unit` — it needs a
full Nitro build and a browser binary — so run it by hand when the preset, the
Nuxt major, or the nuxt-security version moves.
`tests/nuxt-security-contract.test.ts` is the cheap tripwire that runs in CI
instead.

## Media security policy

Media stays restricted to the application origin by default. Set
`runtimeConfig.public.cspMediaSrc` (or `CSP_MEDIA_SRC` at build time /
`NUXT_PUBLIC_CSP_MEDIA_SRC` at runtime) to a comma-separated list of additional
sources, such as `blob:,https://media.example.com`. Browser MSE players
typically need `blob:` here and the media origin in `cspConnectSrc` for manifest
and segment fetches; native HLS needs the media origin in `cspMediaSrc`. These
options extend only their named directives and leave scripts, frames, and
workers unchanged.

## Database backend

Every app states whether it has a database with the `databaseBackend` module
option:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-core'],
  nardukCore: { databaseBackend: 'none' },
})
```

| Value        | The app uses                                 |
| ------------ | -------------------------------------------- |
| `'d1'`       | Cloudflare D1 through the `DB` binding       |
| `'postgres'` | PostgreSQL through the Hyperdrive binding    |
| `'none'`     | No database: a publication-only or proxy app |

Without the option, core reads `NUXT_DATABASE_BACKEND` at build time. An app
that sets neither still gets D1, but it has not declared it, and
[`/api/health`](#health-endpoint) treats a missing D1 binding as `degraded`
rather than as an error. An unknown option value fails the build; an unknown
`NUXT_DATABASE_BACKEND` value is ignored with a warning.

With `'none'`:

- `useDatabase(event)` and accessors made by `createAppDatabase` throw an HTTP
  500 that names the declaration.
- A bearer API key authenticates nobody: `authenticateApiKey` returns `null`.
- `/api/health` reports `database: "not_applicable"` and probes nothing.
- The build fails if `@narduk-enterprises/narduk-auth` is installed, because
  sign-in stores users, sessions and API keys in the app database.

## Health endpoint

Core serves `GET /api/health` for uptime monitors and deploy checks. The
response is never cached (`Cache-Control: no-store`).

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-09-16T17:00:00.000Z",
    "database": "not_applicable",
    "missingAuthTables": [],
    "checks": [
      {
        "name": "database",
        "required": false,
        "result": "skipped",
        "reason": "not-configured"
      },
      {
        "name": "auth-tables",
        "required": false,
        "result": "skipped",
        "reason": "auth-not-enabled"
      },
      {
        "name": "publication",
        "required": true,
        "result": "pass",
        "durationMs": 4,
        "detail": { "releaseId": "2026-09-16.1" }
      }
    ]
  }
}
```

| `status`   | HTTP | Meaning                           |
| ---------- | ---- | --------------------------------- |
| `ok`       | 200  | Every check passed or was skipped |
| `degraded` | 200  | An optional check failed          |
| `error`    | 503  | A required check failed           |

`database` summarizes the built-in probe:

| `database`       | Meaning                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ok`             | The probe passed                                                                                                        |
| `not_applicable` | The app declared `databaseBackend: 'none'`                                                                              |
| `not_available`  | No D1 `DB` binding: `error` for an app that declared its backend, `degraded` for one that only inherited the D1 default |
| `schema_error`   | A narduk-auth table is missing (`degraded`); `missingAuthTables` names it                                               |
| `error`          | The probe failed or took longer than 5 seconds                                                                          |

`checks` lists every check as `{ name, required, result }`, where `result` is
`pass`, `fail` or `skipped`, with `reason` for a skipped check, `error` for a
failed one, and `durationMs` and `detail` when present. The first two entries
are built in:

- `database` runs `SELECT 1` against D1, or `select 1` through Hyperdrive.
- `auth-tables` runs only when narduk-auth is installed on D1. It looks up the
  `users`, `sessions` and `api_keys` tables, which also proves the connection,
  and it is optional.

Registered checks follow, in registration order.

### Registering a check

`registerHealthCheck` is auto-imported in server code, or import it from
`@narduk-enterprises/narduk-core/server/utils/health-checks`. Register from a
Nitro plugin so the check exists before the first request:

```ts
// server/plugins/health-checks.ts
export default defineNitroPlugin(() => {
  registerHealthCheck({
    name: 'publication',
    required: true,
    timeoutMs: 2000,
    async run({ signal }) {
      const manifest = await readPublishedManifest({ signal })
      return { detail: { releaseId: manifest.releaseId } }
    },
  })
})
```

- `name`: 1-63 lowercase letters, digits or hyphens. `database` and
  `auth-tables` are reserved. Registering a name again replaces the earlier
  check, and `registerHealthCheck` returns a function that removes it.
- `required`: a failed required check makes the report `error` (HTTP 503); a
  failed optional check makes it `degraded`.
- `timeoutMs`: defaults to 3000 and may be at most 30000. A check that runs out
  of time fails, and its `signal` is aborted.
- `run`: resolve to pass; throw or return `{ ok: false }` to fail. Checks run
  concurrently with each other and with the database probe.
- `detail`: an optional JSON object published with the result. It is left out,
  with `detailOmitted` saying why, when it is not a plain object, cannot be
  serialized, is larger than 1 KiB, or has a `status` or `database` key at any
  depth.

A failed check publishes fixed text such as `Check failed.`; the thrown error
goes only to the server log.

### Monitoring the endpoint

Prefer the HTTP status where a monitor supports it. A monitor that matches a
substring can rely on `"status":"ok"`: `status`, `timestamp` and `database` are
the first fields of `data`, well inside the first 4096 bytes, and no check
detail can contain a `status` or `database` key.

## Per-route rate limits: `defineRateLimitedHandler`

Wrap a route handler and it is rate limited. The app declares the allowance; it
never writes a limiter, and it never edits a registry in this package.

```ts
// server/api/stations/index.get.ts — auto-imported, like defineEventHandler
export default defineRateLimitedHandler(
  async (event) => listStations(getQuery(event)),
  { key: 'marine-public-api', limit: 120, windowSeconds: 60 },
)
```

`key` names the allowance — use a slug, not a path, because it is also the
`runtimeConfig` override key and the field in the denial log record.

| Option          | Default       | Meaning                                                                                                                           |
| --------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `key`           | required      | Stable identifier for this route's allowance.                                                                                     |
| `limit`         | `120`         | Requests permitted per window.                                                                                                    |
| `windowSeconds` | `60`          | Window length.                                                                                                                    |
| `scope`         | `'ip'`        | `'ip'` — one allowance per client address; `'ip-path'` — per address per path; `'global'` — one allowance shared by every caller. |
| `headers`       | `'both'`      | `'standard'`, `'legacy'`, `'both'` or `'none'` (see below).                                                                       |
| `binding`       | by convention | Explicit wrangler `ratelimits[].name`.                                                                                            |
| `enabled`       | `true`        | Turn the limit off without removing the wrapper.                                                                                  |

### What enforces the limit

Two layers run, and a denial from either answers 429.

1. **The Cloudflare Rate Limiting binding**, when the app declared a matching
   `ratelimits` entry. Its counters are coordinated per Cloudflare location
   rather than per isolate, so it is the more accurate enforcer and it runs
   first.
2. **An in-isolate fixed window**, always. On its own it permits roughly
   `limit x live isolates`, so it is a brute-force and scraper dampener rather
   than a quota. It runs regardless because it is the only source of the
   `RateLimit-*` quota headers — the binding's `.limit()` resolves to
   `{ success }` with no remaining count and no reset instant — the only path
   that supports a window other than 10 or 60 seconds, and the only one that
   exists in `nuxt dev`, in unit tests and under plain Node.

**The binding is an upgrade, never a prerequisite.** Cloudflare does not
document whether it is available on the Workers Free plan, so an app adopts this
helper with no wrangler change at all and can add the binding later without
touching a line of route code.

To enable it, declare the binding under the top-level `ratelimits` array (GA
since 2025-09-19; needs Wrangler >= 4.36.0) and name it `RL_<limit>` to match
the convention this package already uses, or pass `binding` explicitly:

```jsonc
// wrangler.json
{
  "ratelimits": [
    {
      "name": "RL_120",
      "namespace_id": "1001",
      "simple": { "limit": 120, "period": 60 },
    },
  ],
}
```

Cloudflare's `period` accepts only `10` or `60` seconds, so a route with any
other `windowSeconds` is enforced by the in-isolate window alone and looks for
no binding. Cloudflare also describes these counters as "permissive, eventually
consistent, and intentionally designed to not be used as an accurate accounting
system", which is the other reason the local window is kept.

### Response headers

The IETF work is at
[draft-ietf-httpapi-ratelimit-headers-11](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers-11),
which defines `RateLimit-Policy` (the quota policy) and `RateLimit` (the quota
currently available) as Structured Fields — _not_ the familiar
`RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset` triad, which earlier
revisions specified and which is what public APIs actually ship. Both families
are emitted by default so neither kind of client is broken:

```http
RateLimit-Policy: "marine-public-api";q=120;w=60
RateLimit: "marine-public-api";r=119;t=60
RateLimit-Limit: 120
RateLimit-Remaining: 119
RateLimit-Reset: 60
```

Set `headers` to `'standard'` for the draft fields only, `'legacy'` for the
triad only, or `'none'` to publish nothing but `Retry-After`.

A denial answers **429** with `Retry-After`, `RateLimit-Remaining: 0`, the
request's `x-request-id` preserved so a client's report correlates to the server
record, and exactly one structured `warn` through
`@narduk-enterprises/narduk-logging` carrying `rateLimitKey`, `limit`,
`windowSeconds`, `scope`, `enforcedBy` and the **matched route template** — not
the raw path, which carries caller-chosen identifiers and query values.

### Exemptions

These paths are never limited, whatever a route declares: `/api/health`,
`/favicon.ico`, `/robots.txt`, `/sitemap.xml`, `/sitemap_index.xml`,
`/sitemap/*`, `/__sitemap__/*`. A 429 on a health probe reads as an outage, and
a throttled crawler is an SEO self-injury. The query string is ignored, so a
monitor URL with a cache-buster stays exempt.

`runtimeConfig.nardukRateLimit.exemptPaths` **replaces** that list rather than
extending it; a trailing `*` matches by prefix, and an explicitly empty array
means "exempt nothing".

### Operator overrides

```ts
// nuxt.config.ts
runtimeConfig: {
  nardukRateLimit: {
    enabled: true,          // false disables every rate-limited route
    limit: 120,             // default for routes that declare none
    windowSeconds: 60,
    headers: 'both',
    bindings: { 'marine-public-api': 'MARINE_RL' },
    routes: { 'marine-public-api': { limit: 60, windowSeconds: 10 } },
  },
}
```

`routes[key]` wins over what the route itself declared, so an allowance can be
retuned without editing route code. `enabled` is an AND across every layer: the
block switch disables every route regardless of what a route asks for. A
non-integer or non-positive override is rejected rather than adopted.

### Relationship to `enforceRateLimitPolicy`

`runtime/server/utils/rateLimit.ts` keeps its closed `RATE_LIMIT_POLICIES`
registry for this layer's own auth, admin and upload routes, and apps already
calling `enforceRateLimitPolicy` are unaffected. `defineRateLimitedHandler` is
the surface for an **app's own** routes: it adds the handler wrapper, the
`RateLimit-*` headers, the exempt list and the denial log record, over the same
`ratelimits` bindings and the same client-address resolver.

## Database alias contract

Core-owned server code uses two private Nuxt aliases. `#narduk-core/schema`
selects the PostgreSQL core schema when `databaseBackend` is `'postgres'` and
the D1 schema otherwise, while `#narduk-core/postgres-runtime` selects the real
PostgreSQL adapter or the D1-safe stub. Capability packages that need core
tables may use `#narduk-core/schema` after registering the core Nuxt module.

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
   `watchlist/index.get.ts` and `market/big-movers.get.ts` have no page/limit at
   all.

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

`parseSortParam` in today's `query.ts` silently falls back to the default on an
unknown field; the contract **rejects** that key instead — the bug class
stonx#208 named. The stonx adoption PR is deferred from this narduk-libs PR.

## Deprecated components

### `AppEmptyState` — deprecated, removed in the next major

Use `NeStatePanel` from `@narduk-enterprises/narduk-shell` instead
([narduk-libs#254](https://github.com/narduk-enterprises/narduk-libs/issues/254),
backlog item 7; standing decision D4, Logan 2026-09-11: "Deprecate, remove next
major"). `AppEmptyState` still behaves exactly as it did — this release changes
no runtime behaviour — but it will not survive the next narduk-core major.

`AppEmptyState` can only say "nothing here". It cannot tell **unknown** from
**zero**, which is the distinction the surfaces using it actually need, and the
bug class behind operator-portal
[#183](https://github.com/narduk-enterprises/operator-portal/issues/183),
[#162](https://github.com/narduk-enterprises/operator-portal/issues/162),
[#100](https://github.com/narduk-enterprises/operator-portal/issues/100) and
[#21](https://github.com/narduk-enterprises/operator-portal/issues/21).
`NeStatePanel` carries five readings — `empty`, `loading`, `error`, `blocked`,
`absent` — gives each the right ARIA role by construction, and never signals the
reading with colour alone.

The props map one for one:

| `AppEmptyState`         | `NeStatePanel`                                     |
| ----------------------- | -------------------------------------------------- |
| (implicit empty)        | `state="empty"`                                    |
| `title`                 | `title`                                            |
| `description`           | `message`                                          |
| `icon`                  | `icon`                                             |
| default slot (a button) | `#action` slot                                     |
| `compact`               | no equivalent; pass `class` or `ui` if you need it |

```vue
<!-- before -->
<AppEmptyState
  icon="i-lucide-inbox"
  title="No invoices yet"
  description="Create your first invoice to get started."
>
  <UButton to="/invoices/new" icon="i-lucide-plus">Create invoice</UButton>
</AppEmptyState>

<!-- after -->
<NeStatePanel
  state="empty"
  icon="i-lucide-inbox"
  title="No invoices yet"
  message="Create your first invoice to get started."
>
  <template #action>
    <UButton to="/invoices/new" icon="i-lucide-plus">Create invoice</UButton>
  </template>
</NeStatePanel>
```

A migrating app also gains `loading`, `error`, `blocked` and `absent` for free,
plus the `gaps` / `unblocksOn` vocabulary — see
[narduk-shell's README](../../design/narduk-shell/README.md#nestatepanel).

A one-time, **dev-only** `console.warn` points at `NeStatePanel` the first time
`AppEmptyState` is set up in a development process. Production stays silent, and
the empty-state markup is unchanged. The `@deprecated` JSDoc on the component
gives editors and `vue-tsc` the strike-through and the same pointer.

### `AppConfirmModal` — deprecated, removed in the next major

Superseded by `NeConfirmDialog` and `useConfirm()` in
[`@narduk-enterprises/narduk-shell`](../../design/narduk-shell/README.md#neconfirmdialog--useconfirm)
(components backlog item 16,
[narduk-libs#263](https://github.com/narduk-enterprises/narduk-libs/issues/263);
decision D4, 2026-09-11: deprecate now, remove in the next narduk-core major).

Behaviour is unchanged in this release — the component still works exactly as it
did. A one-time, dev-only `console.warn` points at `NeConfirmDialog` /
`useConfirm()` the first time the component is used. New code should use the
suite; existing call sites can migrate at their own pace before the next major.

**Migration mapping**

| `AppConfirmModal`              | `NeConfirmDialog`                | Notes                                                                                                         |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `v-model`                      | `v-model:open`                   | Nuxt UI v4's overlay model; the `narduk/no-legacy-overlay-model` lint rule already wants this spelling.       |
| `title`                        | `title`                          | Same default (`Are you sure?`).                                                                               |
| `message`                      | `message`                        | Now also the dialog's `aria-describedby` target.                                                              |
| `confirmLabel` / `cancelLabel` | `confirmLabel` / `cancelLabel`   | Same defaults.                                                                                                |
| `confirmColor="error"`         | `tone="danger"`                  | Also moves initial focus to Cancel. `confirmColor` was `error` by default; `tone` is `default` by default.    |
| `confirmColor` (other values)  | `tone="default"`                 | The suite offers two tones deliberately. A one-off colour is a sign the dialog is doing more than confirming. |
| `loading`                      | `pending`                        | Additionally disables cancel and turns off Escape / outside-click dismissal (`preventClose`).                 |
| `dismissible`                  | — (derived)                      | Dismissal is on unless `pending`; there is no separate switch.                                                |
| `icon` / icon tone             | — (dropped)                      | The tone colours the confirm button instead. Put an icon in the body if a call site genuinely needs one.      |
| default slot                   | `#body` slot, or the `body` prop | `AppConfirmModal`'s default slot landed in `UModal`'s trigger slot; `#body` puts it in the dialog body.       |
| `@confirm` / `@cancel`         | `@confirm` / `@cancel`           | Unchanged, including that `@confirm` deliberately leaves the dialog open.                                     |

Most call sites are better off dropping the markup entirely:

```ts
const confirm = useConfirm()
if (
  !(await confirm({
    title: 'Delete invoice?',
    message: 'This cannot be undone.',
    tone: 'danger',
  }))
) {
  return
}
```

### `AppSettingsProfile` — deprecated, removed in the next major

Superseded by `NeSettingsPage` (with `NeForm` and `NeFormSection`) in
[`@narduk-enterprises/narduk-shell`](../../design/narduk-shell/README.md#nesettingspage)
(components backlog item 19,
[narduk-libs#266](https://github.com/narduk-enterprises/narduk-libs/issues/266);
decision D4, 2026-09-11: deprecate now, remove in the next narduk-core major).

Behaviour is unchanged in this release — the component still works exactly as it
did. A one-time, dev-only `console.warn` points at `NeSettingsPage` the first
time the component is used. New code should use the suite; existing call sites
can migrate at their own pace before the next major.

`AppSettingsProfile` bundled a fixed profile card — name, email, an avatar
uploader, and a "quick links" sidebar — with no schema validation, no protection
against a double-click firing `@save` twice, and a `saving` prop the caller has
to wire and flip by hand. `NeSettingsPage` composes `NeForm`'s save bar (one
submit per click, a loading button with no ref to wire, dirty state that only
clears once the save resolves) with one or more titled `NeFormSection`s, so a
settings screen states its own fields instead of fitting inside one fixed card
shape.

**Migration mapping**

| `AppSettingsProfile`                         | `NeSettingsPage` / `NeForm` / `NeFormSection`            | Notes                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `title` / `subtitle`                         | `title` (on `NeSettingsPage`)                            | The suite has one title, not a title/subtitle pair; put the subtitle in `description` if it is a sentence.             |
| `initial-name`, `email`, ...                 | `state` (a reactive object)                              | `NeSettingsPage`/`NeForm` are controlled: pass a `reactive()` object and bind fields to it with `UFormField`/`UInput`. |
| `@save="handleSave"`                         | `@submit` (via the `onSubmit` prop, called `:on-submit`) | Fires once per click and disables the button for the promise's duration — no `:saving` prop to wire by hand.           |
| `saving` prop                                | — (automatic)                                            | `UButton`'s own `loading-auto` drives this from the `onSubmit` promise; nothing to pass in.                            |
| avatar upload (`show-avatar`, cropping, ...) | — (dropped)                                              | Not part of the suite. Keep a bespoke avatar uploader as a field inside a `NeFormSection` if a call site needs one.    |
| `settings-links` / `#settings-sidebar` slot  | — (dropped)                                              | Page-level navigation is an app concern; render it around `NeSettingsPage`, not inside it.                             |
| `#extra-fields` slot                         | the default slot, inside a `NeFormSection`               | Add fields as `UFormField`s inside one or more sections rather than one fixed slot.                                    |

```vue
<!-- before -->
<AppSettingsProfile
  :initial-name="user.name"
  :email="user.email"
  :saving="isSaving"
  @save="handleSave"
/>

<!-- after -->
<script setup lang="ts">
const state = reactive({ name: user.name })
async function handleSave(data: { name: string }) {
  await saveProfile(data)
}
</script>

<template>
  <NeSettingsPage title="Your identity" :state="state" :on-submit="handleSave">
    <NeFormSection title="Profile">
      <UFormField name="name" label="Display name">
        <UInput v-model="state.name" />
      </UFormField>
      <UFormField name="email" label="Email">
        <UInput :model-value="user.email" disabled />
      </UFormField>
    </NeFormSection>
  </NeSettingsPage>
</template>
```
