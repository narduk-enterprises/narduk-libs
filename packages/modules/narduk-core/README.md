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

## Error page and exception capture

Both ship with the module. An app that pins narduk-core gets them with no file
of its own — no `error.vue`, no error listeners, no configuration.

### The error page

The module sets Nuxt's `app.errorComponent` from the `app:resolve` hook. Nuxt's
own `resolveApp()` assigns that field just before calling the hook: an
`app/error.*` from the project or any layer when one exists, and otherwise
Nuxt's built-in `nuxt-error-page.vue`. The module replaces **only** the
built-in, so an app-owned error page still wins and nothing has to be copied
into a repository or managed by a codemod. Apps install this package as a module
rather than a layer, which is why the layer-directory path Nuxt scans never
reaches `runtime/app/error.vue` on its own.

The page shows the status code with plain-language copy for the outcome (404,
403, 401, 429, 503, and a fallback), a **Go Home** action (`clearError`), a
**Try Again** action (`reloadNuxtApp`), `robots: noindex, nofollow`, and the
**request id**.

The request id is the value `x-request-id` carries and the one every
narduk-logging server record is keyed by, so a user reading it off the page
hands support the key that finds the log line. It is resolved during SSR from
`event.context._requestId` and transferred through the Nuxt payload
(`useRequestId()`), because a browser cannot read the response header of the
document it is running in. The `requestLogger` middleware also echoes the id
back onto the incoming request headers, so a re-entrant render of the failed
page adopts the same id instead of minting a new one.

The raw error message appears only where `previewSafeMode` is on — preview,
staging, and any deployment an operator has explicitly marked non-production.
Production traffic sees the status-code copy and nothing else.

E2E selectors: `error-page`, `error-page-status`, `error-page-title`,
`error-page-description`, `error-page-request-id`, `error-page-home`,
`error-page-retry`, `error-page-detail`.

To override the page, add `app/error.vue` to the app. To keep this page and wrap
it, re-export it:

```vue
<script setup lang="ts">
export { default } from '@narduk-enterprises/narduk-core/app/error-page'
</script>
```

### Exception capture

One seam, `narduk:exception`, carried on the runtime's own hook bus. Three
capture sites feed it and never talk to a reporter directly, so adding a
destination never means adding a second capture path:

| Site                | Hook                 | Fatal    |
| ------------------- | -------------------- | -------- |
| Vue component error | `vue:error` (client) | no       |
| Fatal app error     | `app:error` (client) | yes      |
| Any Nitro error     | `error` (server)     | 5xx only |

One report per error. `vue:error` and `app:error` both fire when a component
failure is escalated to the app error boundary, and Nitro can announce one
handled error twice; both are deduplicated.

Each report carries the route **pattern** (`/stations/:id`, never a raw path, so
record ids and slugs stay out of it), the build version, the request id, the
status code, and a message with query strings and email addresses redacted.

**Nothing here logs.** narduk-logging's `installNitroLogging` already writes
exactly one record per failing request — including 4xx and unrouted paths since
narduk-libs#359 — so a record written by the capture plugin would double every
server error. Server log records now also carry `buildVersion`.

Subscribe a destination:

```ts
import { onNardukException } from '@narduk-enterprises/narduk-core/shared/exception-report'
import { defineNuxtPlugin } from '#imports'

export default defineNuxtPlugin({
  name: 'app-exception-reporter',
  setup(nuxtApp) {
    onNardukException(nuxtApp as never, (report) => {
      // report.route, report.requestId, report.statusCode, report.buildVersion
    })
  },
})
```

`@narduk-enterprises/narduk-analytics` registers the PostHog reporter for client
exceptions; see its README. When a reporter throws, the error being reported is
not escalated.

Operational guide:
[an error page is showing / exceptions are spiking](../../../docs/operations/error-page-and-exceptions.md).

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
failed one, `kind` for a check built by a core helper, and `durationMs` and
`detail` when present. The first two entries are built in:

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
  failed optional check makes it `degraded`. On a failing entry, `required` is
  that failure's own rollup contribution, which matters only for a check that
  can fail at more than one severity — see
  [freshness checks](#reporting-data-freshness) below.
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

### Reporting data freshness

An app that serves published data is up long after its feed has gone stale. A
plain `registerHealthCheck` cannot say so without a choice between silence and a
503, so core ships the freshness check as its own helper.
`registerFreshnessCheck` is auto-imported in server code, or import it from
`@narduk-enterprises/narduk-core/server/utils/freshness-checks`:

```ts
// server/plugins/health-checks.ts
export default defineNitroPlugin(() => {
  registerFreshnessCheck({
    name: 'observations-freshness',
    source: 'ndbc-realtime-observations',
    warnAfter: 45 * 60,
    failAfter: 6 * 60 * 60,
    timeoutMs: 30_000,
    async read({ signal }) {
      const { product } = await readPublishedProduct({ signal })
      return {
        at: product.freshness.asOf,
        detail: { releaseId: product.releaseId },
      }
    },
  })
})
```

Each registration adds one entry to `checks`:

```json
{
  "kind": "freshness",
  "name": "observations-freshness",
  "required": false,
  "result": "fail",
  "durationMs": 12,
  "detail": {
    "releaseId": "2026-09-16.1",
    "source": "ndbc-realtime-observations",
    "warnAfterSeconds": 2700,
    "failAfterSeconds": 21600,
    "observedAt": "2026-09-16T13:10:00.000Z",
    "ageSeconds": 3000,
    "reason": "stale"
  }
}
```

- `name` and `timeoutMs` follow the rules above; `kind` is always the literal
  `freshness`, so a detector can select every freshness entry across apps
  without knowing app-chosen names.
- `source`: which upstream feed this check watches, 1-128 characters. Register
  one check per feed.
- `read`: resolve to `{ at, detail? }`. `at` is a `Date`, an ISO 8601 string or
  epoch **milliseconds**; the optional `detail` is published underneath the
  computed fields.
- `warnAfter` / `failAfter`: ages in **seconds**, at most one year. `failAfter`
  must be at least `warnAfter` and may be omitted.
- `now`: an epoch-millisecond clock, for tests. Defaults to `Date.now`.

| Data age            | `result` | `required`  | Report     | HTTP |
| ------------------- | -------- | ----------- | ---------- | ---- |
| at most `warnAfter` | `pass`   | as declared | unchanged  | 200  |
| past `warnAfter`    | `fail`   | `false`     | `degraded` | 200  |
| past `failAfter`    | `fail`   | `true`      | `error`    | 503  |

A stale feed therefore degrades the app; it takes it down only once `failAfter`
is crossed, and a check registered without `failAfter` can never get there.
`observedAt` and `ageSeconds` are published while the check is passing too, so a
dashboard can plot age before anything is wrong. A timestamp in the future is
never stale — a producer clock ahead of the Worker shows up as a negative
`ageSeconds`.

A freshness check **fails closed**. No timestamp, an unparseable one, a `read`
that throws, and a `read` that runs out of time all fail at the strongest
severity the thresholds allow, never pass, and say which in `detail.reason`
(`missing-timestamp`, `invalid-timestamp`, `unreadable`, or `stale`). The cause
of a thrown read goes to the server log only.

Under the hood a check that can fail at two severities returns
`{ ok: false, severity: 'degraded' }` from `run`, which publishes that entry's
`required` as `false`. A check declared `required: false` can never escalate
itself to `error`, so the rollup keeps reading a single field.

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

## Typed API contracts: `defineValidatedHandler`

Give a route a signature. The schemas are the contract: the handler receives
`query`, `params` and `body` already parsed and fully typed, and never touches
`getQuery`, `getRouterParam` or `readBody`.

```ts
// server/api/stations/[stationId]/history.get.ts — auto-imported
export default defineValidatedHandler({
  params: z.object({ stationId: z.string().min(1) }),
  query: z.object({
    limit: z.coerce.number().int().min(1).max(2000).default(500),
    resolution: z.enum(['raw', 'hourly', 'daily']).default('raw'),
  }),
  handler: ({ params, query }) => readHistory(params.stationId, query),
})
```

A route declares only the parts it has. An undeclared part is `undefined` in the
handler and is never read — a route with no `body` schema never touches the
payload.

| Option             | Default           | Meaning                                                                      |
| ------------------ | ----------------- | ---------------------------------------------------------------------------- |
| `handler`          | required          | The route. Receives `{ body, event, params, query }`.                        |
| `query`            | —                 | Schema for `getQuery`: values arrive as strings, so `z.coerce` most numbers. |
| `params`           | —                 | Schema for the route params (`[stationId]`): always strings.                 |
| `body`             | —                 | Schema for the JSON body. Only read for `POST`, `PUT`, `PATCH`, `DELETE`.    |
| `response`         | —                 | Shape this route promises. **Checked, never used to reshape** — see below.   |
| `maxBodyBytes`     | `1048576` (1 MiB) | Body ceiling. Over it answers 413 before the payload is parsed.              |
| `validateResponse` | dev and test      | `true`, `false`, or a sampling rate in `(0, 1)`.                             |

### On a bad request

**400**, with the detail in `data` — the field h3 serializes on every runtime:

```json
{
  "statusCode": 400,
  "statusMessage": "Bad Request",
  "data": {
    "code": "VALIDATION_FAILED",
    "issues": [
      {
        "path": "params.stationId",
        "message": "Too small: expected string to have >=1 characters"
      },
      {
        "path": "query.limit",
        "message": "Too big: expected number to be <=2000"
      }
    ]
  }
}
```

`path` is rooted at the part of the request it came from, so a client can group
by prefix without a second field. **A submitted value never appears** — not in a
message, not in the path — so a rejected password or token cannot travel back
out through the error.

What does survive is an object _key_, because a path with no key in it is not
actionable. A key `z.strictObject` rejected comes back as a path segment
(`body.password`) with the constant message `Unrecognized key`, never as prose.
Three things worth knowing about that narrow exception:

- For a declared field the key is the schema's own. For a `z.record` it is
  caller data, so a route whose _keys_ are secrets (`{ [apiKey]: … }`) should
  not use one.
- The guarantee covers zod's built-in messages. A schema that supplies its own
  `error` callback interpolating `issue.input` is forwarded verbatim and owns
  that choice.
- A failed `z.union` reports one issue at the union's own path
  (`{ "path": "body", "message": "Invalid input" }`) and its branch failures are
  deliberately not flattened: they contradict each other, and their prose
  carries caller key names. Use `z.discriminatedUnion` when a sum-typed body
  needs per-field detail — it reports against the discriminator directly.

Params and query are checked together, so one response names every bad field.
The body is only read once they pass: a request that is already doomed should
not buy a payload read.

Two more, both carrying `data.code`:

| Status | `data.code`              | When                                                            |
| ------ | ------------------------ | --------------------------------------------------------------- |
| `413`  | `BODY_TOO_LARGE`         | Declared or measured body over `maxBodyBytes` (also in `data`). |
| `415`  | `UNSUPPORTED_MEDIA_TYPE` | A body that is not JSON. This wrapper reads JSON only.          |

A declared `content-length` is rejected before a byte is parsed. A body sent
chunked — no declared length — is measured after the read, so the ceiling bounds
what reaches `JSON.parse` and the schema, which is the cost this wrapper owns;
the request size itself is bounded by the platform.

The 415 covers a body sent with **no `content-type` at all**, not only one sent
with the wrong type. Declaring `application/json` is what forces a CORS
preflight, so a body with no media type is a simple request any cross-origin
page can send; accepting it would hand back the protection the 415 buys. A
request carrying no body is left to the schema's own 400 instead — there is no
media type to object to.

### On a bad response

`response` is an assertion about what the route promises. A returned value that
fails it is a server defect: one structured `error` through
`@narduk-enterprises/narduk-logging` carrying the issue paths and the **matched
route template** — not the raw path — then **500**. In development and test the
message names the offending paths; in production it says nothing beyond
`Internal Server Error`, because the detail describes data the caller was never
entitled to see.

**Checking is on in development and test, off in production by default.** Every
request on Workers pays for it in metered CPU, on data the server itself
produced, and a response-shape mismatch is a code defect — which is what
`nuxt dev`, vitest and CI are for. Turn it on with `validateResponse: true`, or
keep most of the signal for a fraction of the cost with
`validateResponse: 0.01`.

Because it is an assertion, **the value the client receives is exactly what the
handler returned**, whether or not the check ran. That is deliberate: a route
must not behave differently in production because validation was skipped. Two
consequences:

- A response schema must not `.transform()`, default or coerce. Nothing it does
  would reach the wire.
- An unpromised field is not silently stripped. Use `z.strictObject` to have one
  _rejected_ instead — loudly, in dev and test, where you can fix it.

### Composition order with `defineRateLimitedHandler`

**Rate limit outside, validate inside.** A throttled caller is then rejected
before the body is read or a schema runs, which is the order that matters when
the caller is abusive:

```ts
export default defineRateLimitedHandler(
  defineValidatedHandler({
    query: stationSearchQuery,
    handler: ({ query }) => listStations(query),
  }),
  { key: 'marine-public-api', limit: 120, windowSeconds: 60 },
)
```

Reversed, every request over the limit still pays for parsing and validation
before the 429. There is no `rateLimit` option on `defineValidatedHandler` on
purpose: one wrapper, one job, and the order stays visible in the route file.

### Before and after: a real Buoys route

`apps/web/server/api/ndbc/stations/[stationId]/history.get.ts`, as it stands
today:

```ts
export default defineEventHandler(async (event) => {
  setMarinePublishedHistoryCacheHeader(event)
  const stationId = getRouterParam(event, 'stationId')
  if (!stationId)
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'stationId is required',
    })
  const result = stationHistoryQuerySchema.safeParse(getQuery(event))
  if (!result.success)
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Invalid station history query',
      data: result.error.flatten(),
    })
  return withPublishedDataErrorHandling(
    event,
    'Published station history is unavailable.',
    async () => {
      const { product } = await readCachedPublishedBuoyStatus()
      return publishedStationHistoryResponse(product, stationId, result.data)
    },
  )
})
```

and the same route through the wrapper:

```ts
export default defineValidatedHandler({
  params: z.object({ stationId: z.string().min(1) }),
  query: stationHistoryQuerySchema,
  handler: ({ event, params, query }) => {
    setMarinePublishedHistoryCacheHeader(event)
    return withPublishedDataErrorHandling(
      event,
      'Published station history is unavailable.',
      async () => {
        const { product } = await readCachedPublishedBuoyStatus()
        return publishedStationHistoryResponse(product, params.stationId, query)
      },
    )
  },
})
```

What changed: the hand-written presence check is gone and `params.stationId` is
`string`, not `string | undefined`; the two hand-written 400s collapse into one
documented body; and a request that is wrong in both the param and the query is
now told both at once instead of only the first. The route keeps its own cache
header and its own error wrapper — this wrapper owns the contract, not the
route's behaviour.

### Sharing the contract with a client

The schemas are ordinary values, so a route can export them and a caller can
reuse them without a second declaration:

```ts
// server/api/stations/index.get.ts
export const contract = { query: stationSearchQuery, response: stationList }
export default defineValidatedHandler({ ...contract, handler: listStations })
```

```ts
// app/composables/useStations.ts
import { contract } from '~~/server/api/stations/index.get'

type StationQuery = z.input<typeof contract.query>
```

That needs nothing from this package. Generating a typed `$fetch` client across
the whole API surface is a larger piece of work and is deliberately not here.

## Edge cache: setCacheProfile

`setCacheProfile` owns every `Cache-Control` string a route would otherwise
hand-write. Import it from
`@narduk-enterprises/narduk-core/server/utils/cacheProfile`.

```ts
import { setCacheProfile } from '@narduk-enterprises/narduk-core/server/utils/cacheProfile'

export default defineEventHandler(async (event) => {
  const stations = await readPublishedStations()
  setCacheProfile(event, 'live', { tags: ['stations', 'published-data'] })
  return stations
})
```

| Profile  | Browser | Edge  | Stale window | For                                                     |
| -------- | ------- | ----- | ------------ | ------------------------------------------------------- |
| `live`   | 60s     | 300s  | 900s         | the live-ish surface of a published product             |
| `slow`   | 300s    | 900s  | 1800s        | history, coverage, other slower-changing published data |
| `static` | 300s    | 3600s | 86400s       | documents that change on deploy, not per request        |
| `none`   | —       | —     | —            | `private, no-store`                                     |

A route that genuinely needs its own numbers passes them inline instead of
adding a profile:
`setCacheProfile(event, { maxAge: 30, sMaxAge: 120, swr: 600 })`. Add
`private: true` to keep the response off the edge entirely.

### Why no `s-maxage`

The obvious encoding of "60s in the browser, 300s at the edge, serve stale for
900s" is `public, max-age=60, s-maxage=300, stale-while-revalidate=900`. **It
does not work.** Cloudflare, following
[RFC 9111 §4.2.4](https://www.rfc-editor.org/rfc/rfc9111#section-4.2.4),
documents that `s-maxage`, `must-revalidate` and `proxy-revalidate` each
_disable_ `stale-while-revalidate` and `stale-if-error`:

> When you want `stale-while-revalidate` to take effect at the edge, use
> `max-age` for the freshness window — not `s-maxage`. If you need a longer edge
> TTL than browsers should honor while still using `stale-while-revalidate`, use
> `cdn-cache-control` for the edge directive.
>
> —
> [Workers Cache configuration](https://developers.cloudflare.com/workers/cache/configuration/)

So a profile's `sMaxAge` is emitted as `CDN-Cache-Control: max-age=<n>`, never
as `Cache-Control: s-maxage=<n>`. The browser reads `Cache-Control`, the edge
reads the more specific `CDN-Cache-Control`, and the stale window survives in
both. Header precedence at Cloudflare is `cloudflare-cdn-cache-control` >
`cdn-cache-control` > `Cache-Control`; the helper uses the middle one because
Cloudflare respects it _and_ passes it downstream, so the edge TTL stays visible
when you are debugging a response.

### This needs Workers Cache turned on

Workers run _before_ the cache, so a response a Worker generates is not stored
by the zone cache at all. These headers bind only once the app opts into Workers
Cache in its Wrangler config (Wrangler >= 4.69.0):

```jsonc
{
  "cache": { "enabled": true },
}
```

Until an app adds that, `setCacheProfile` still produces a correct browser
`Cache-Control` and the edge headers are inert. Adding it is a one-line change
and the profiles are already correct when you do.

By default Workers Cache partitions its cache by Worker version, so **a
deployment already starts from a cold cache** — a release is visible immediately
with nothing to purge. That default only changes if an app sets
`cache.cross_version_cache: true`.

### Cache-Tag

`tags` emits a `Cache-Tag` header so a later purge can invalidate exactly the
responses a change affected. Purge by tag is available on every Cloudflare plan
(it stopped being Enterprise-only on 2025-04-01), and Cloudflare strips the
header before the client sees it.

Tags must be printable ASCII with no spaces or commas, at most 1024 characters
each, and at most 1000 per response. Tags that violate that are dropped rather
than throwing — the platform drops them silently too — and the header is omitted
when none survive. Deduplication is case-insensitive because purge matching is.

Purging is `cache.purge({ tags: [...] })` from `cloudflare:workers` inside the
Worker. A zone-level purge — dashboard, `/zones/{id}/purge_cache`, or Terraform
— does **not** reach Workers Cache content.

### Guards

`setCacheProfile` emits `private, no-store` instead of the requested profile,
and no `Cache-Tag`, when any of these hold:

| Guard               | Reason                                                         |
| ------------------- | -------------------------------------------------------------- |
| `error-status`      | the response status is >= 400                                  |
| `set-cookie`        | a `Set-Cookie` is already on the response                      |
| `vary-wildcard`     | `Vary: *`, which Cloudflare treats as uncacheable anyway       |
| `preview-safe-mode` | `previewSafeMode` — a preview must not populate a shared cache |

None of these are overridable by configuration. The returned
`CacheProfileResult` carries `suppressedBy` so a caller or a test can see which
guard fired rather than discovering a missing header later.

### Tuning without touching a route

`runtimeConfig.cache.profiles` overrides the seconds of any named profile. Each
field is optional and the rest of the profile is kept:

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

  cache: {
    profiles: {
      live: { sMaxAge: 120 },
      static: { noStore: true },
    },
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

Note what that means before adding a freshness check to an app already enrolled
in an uptime detector: a monitor matching `"status":"ok"` alerts on `degraded`
as well as on `error`, because the substring is simply absent. That is often the
point — a stale feed should be noticed — but it makes `warnAfter` an alerting
threshold, not just a dashboard one. Pick it accordingly, or move the monitor to
the HTTP status so only `failAfter` pages.

Negative, fractional and non-numeric overrides are ignored rather than emitted.
An inline profile is the app's own configuration already, so it is used
verbatim.

### Migrating an app off hand-written strings

`buoys` is the worked example. Its three helpers become three calls, and the
broken stale windows start working:

```diff
--- a/apps/web/server/utils/marine-api-route.ts
+++ b/apps/web/server/utils/marine-api-route.ts
+import { setCacheProfile } from '@narduk-enterprises/narduk-core/server/utils/cacheProfile'
+
 export function setMarinePublishedDataCacheHeader(event: H3Event) {
-  setHeader(event, 'Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=900')
+  setCacheProfile(event, 'live', { tags: ['published-data'] })
 }

 export function setMarinePublishedHistoryCacheHeader(event: H3Event) {
-  setHeader(
-    event,
-    'Cache-Control',
-    'public, max-age=300, s-maxage=900, stale-while-revalidate=1800',
-  )
+  setCacheProfile(event, 'slow', { tags: ['published-data', 'ndbc-history'] })
 }
```

```diff
--- a/apps/web/server/utils/marine-sitemap.ts
+++ b/apps/web/server/utils/marine-sitemap.ts
+import { setCacheProfile } from '@narduk-enterprises/narduk-core/server/utils/cacheProfile'
+
 export function setMarineSitemapCacheHeader(event: H3Event) {
-  setHeader(
-    event,
-    'Cache-Control',
-    'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
-  )
+  setCacheProfile(event, 'static', { tags: ['sitemap'] })
 }
```

The `live`, `slow` and `static` profiles carry Buoys' existing numbers
unchanged, so the browser TTL of every route is identical before and after. What
changes is that the edge TTL moves to a header Cloudflare will honor and the
stale windows stop being silently discarded.

## Reader preferences: units, time zone and locale

A Narduk app stores measurements in SI and displays them in whatever the reader
asked for. `usePreferences()` holds the choice, `useFormatters()` applies it,
and the pure formatters underneath do the arithmetic. **Adoption is per value**:
nothing here rewrites an app's existing display code, and a page opts in one
call site at a time.

```vue
<script setup lang="ts">
const format = useFormatters()
const { setUnits, units } = usePreferences()
</script>

<template>
  <dl>
    <dt>Wave height</dt>
    <dd>{{ format.height(buoy.waveHeightMetres) }}</dd>
    <dt>Wind</dt>
    <dd>{{ format.speed(buoy.windSpeedMetresPerSecond) }}</dd>
    <dt>Observed</dt>
    <dd>{{ format.dateTime(buoy.observedAt) }}</dd>
  </dl>
  <UButton @click="setUnits(units === 'imperial' ? 'metric' : 'imperial')">
    Switch units
  </UButton>
</template>
```

Both composables are auto-imported by this module. The pure functions import
explicitly from `@narduk-enterprises/narduk-core/shared/utils/units`, and a
Nitro route reads the same preferences with `readPreferences(event)` from
`@narduk-enterprises/narduk-core/server/utils/preferences`.

### The cookie

One cookie, `ne_prefs`, carries the whole selection as a small versioned
parameter string:

```text
v=1&u=imperial&tz=America%2FChicago&l=en-US
```

It is read during SSR, so the first paint already has the reader's units — there
is no client-only flash of the wrong one. It is **validated on read**: a cookie
from a future schema version, a truncated one, a hand-edited one, one naming a
time zone this runtime does not know, or one that is not a parameter string at
all decodes to _no selection_ and the documented defaults apply. A bad cookie is
never a 500, and a cookie with one bad field keeps its good ones.

Only fields the reader actually chose are written, so setting units leaves the
time zone following the defaults.

### Defaults when the cookie is unset

| Preference | Default                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| `locale`   | the highest-quality usable tag in `Accept-Language`, else `en-US`              |
| `units`    | `imperial` when that locale's region is `US` (`en-US`, `es-US`), else `metric` |
| `timeZone` | `UTC`, until the browser reports its own — see below                           |

The region is read as written and never maximised:
`Intl.Locale('en').maximize()` answers `en-Latn-US`, which would quietly make
every region-less English speaker in the world imperial.

### Hydration

The server-rendered text and the client's first render are the same string, so
Vue reports no hydration mismatch (Buoys' end-to-end console tracker fails on
one). Two rules get that:

1. **Both sides read the same cookie.** `useCookie` gives the same value during
   SSR and in the browser.
2. **Both sides read the same defaults.** The server resolves them once from
   `Accept-Language` and puts the answer in the Nuxt payload through `useState`.
   The client never re-derives them from `navigator.language`, which can
   disagree with the header that was actually sent.

The browser's time zone is the one input the server cannot have, so it is
**not** read during render. When the cookie carries no zone, both sides render
`UTC`; after mount, `usePreferences()` detects
`Intl.DateTimeFormat().resolvedOptions().timeZone` and writes it to the cookie,
which is an ordinary reactive update on an already-hydrated page. A reader who
has chosen a zone is left alone.

`tests/preferences-state.test.ts` proves this the way Vue does: it renders with
`renderToString`, hydrates that exact markup with a real
`createSSRApp().mount()`, and fails on a hydration warning. Its last case is a
control that reproduces the naive implementation — the client re-deriving its
own defaults — and requires the warning to appear, so a passing suite is not
merely a suite that never looks.

### Cache safety

HTML rendered with one reader's units must never be served to another reader out
of a shared cache. Calling `usePreferences()` during SSR, or `readPreferences()`
in a route, marks the response, and the marked response is forced to
`Cache-Control: private, no-store` with `Vary: Cookie` in two places:

- **`setCacheProfile`** gains a `preferences-cookie` suppression reason, so a
  route that reads preferences cannot advertise a shared-cacheable profile.
- **The `preferences-cache` Nitro plugin** does the same for the rendered SSR
  document on `render:response`, which is the response that actually carries the
  preference-shaped HTML.

Nothing downgrades a response that never read preferences, so **an app's
existing cache profiles are unchanged** — Buoys' `live`/`slow`/`static` routes
keep exactly the headers they have today until they opt a value in.

An app that needs its SSR HTML edge-cached should therefore not format on the
server: return canonical SI values from a shared-cacheable route and bind the
formatters in the browser, where the preference cookie costs nothing.

### The formatters

Every formatter is a standalone pure function over its arguments, so importing
one does not ship the rest. Canonical inputs are SI.

| Function                                                      | Input                                  | Imperial                    | Metric                     | Default precision |
| ------------------------------------------------------------- | -------------------------------------- | --------------------------- | -------------------------- | ----------------- |
| `formatDistance`                                              | metres                                 | feet below 1 mi, then miles | metres below 1 km, then km | 0 small / 1 large |
| `formatSpeed`                                                 | metres per second                      | mph                         | km/h                       | 1                 |
| `formatTemperature`                                           | degrees Celsius                        | Fahrenheit                  | Celsius                    | 0                 |
| `formatHeight`                                                | metres                                 | feet                        | metres                     | 1                 |
| `formatLength`                                                | metres                                 | feet                        | metres                     | 0                 |
| `formatPressure`                                              | hectopascals                           | inHg                        | hPa                        | 2 / 0             |
| `formatDecimal`                                               | number                                 | n/a                         | n/a                        | up to 3           |
| `formatZonedDate` / `formatZonedTime` / `formatZonedDateTime` | `Date`, epoch ms or a parseable string | n/a                         | n/a                        | `Intl` styles     |

`formatHeight` and `formatLength` never auto-scale, which is why a 1.4 m swell
stays `4.6 ft` instead of becoming `0.0 mi`. `formatPressure` appends its symbol
itself because `Intl`'s sanctioned unit list has neither hectopascals nor inches
of mercury; everything else uses a real `style: 'unit'` so the locale decides
spacing and symbol form.

Rules the whole suite keeps:

- **No ambient clock, zone or locale.** `timeZone` and `locale` are arguments;
  absent, the fixed fallbacks `UTC` and `en-US` apply, never the host's.
- **Absent input has one answer.** `null`, `undefined`, `NaN`, `Infinity` and an
  unparseable date all render an em dash (`NE_EMPTY_VALUE`), overridable per
  call with `empty`. No call site has to guard and no reader ever sees `NaN ft`.
- **Per-call options win**, so one value can opt out of the reader's units
  without touching the rest of the page:
  `format.height(x, { units: 'metric' })`.
- **No new dependency.** `Intl.NumberFormat` and `Intl.DateTimeFormat` do the
  work, and `Intl` owns every daylight-saving transition date rather than a
  hand-rolled table.

Knots are deliberately not a third unit system: the preference has two values,
and a maritime app that wants knots should say so at the call site rather than
make a stored preference mean something other than what it says.

### Relation to `narduk-shell/format`

`@narduk-enterprises/narduk-shell/format` is the estate's framework-free
formatter suite for dates, numbers, money and percentages, with no notion of a
reader. This module is the preference layer: unit conversion plus the store that
decides which units. An app can use either or both; nothing here duplicates a
`narduk-shell` export, and this package does not depend on `narduk-shell`.

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

## Published data: the narduk-data product client

`createNardukDataClient` reads a published [narduk-data](https://data.nard.uk)
product — manifest, immutable artifact, SHA-256 check — with the timeout, retry,
coalescing, stale and freshness policy every consumer was otherwise re-deriving.
`fetchNardukDataJson` is the typed request underneath it, for the reads that are
not a product artifact.

Import from `@narduk-enterprises/narduk-core/server/utils/narduk-data`, or use
the Nitro auto-import inside an app that has the layer installed.

### What it does

- **The manifest names the artifact** — the artifact URL is always built from
  `manifest.artifact.path` inside `releases/<releaseId>/`, so a renamed artifact
  keeps working. `product.artifactPath` is an optional assertion: set it and a
  manifest naming anything else is refused. A path that is not a single safe
  segment is refused before any request.
- **Timeout** — every attempt carries its own `AbortSignal.timeout`
  (`timeoutMs`, default 15000). A caller's `signal` cancels **that caller's**
  read only; it is never given to the shared upstream read, so one client
  disconnecting cannot fail the readers coalesced onto it.
- **Bounded retry** — only for an idempotent `GET`/`HEAD`, and only on a
  transport failure: network, timeout, or HTTP 5xx. A 4xx, a schema failure and
  a checksum mismatch are never repeated, and a non-GET is attempted exactly
  once whatever it returns. `retries` (default 1) is the number of extra
  attempts; there is no backoff sleep, so no timer is left behind.
- **Single-flight** — concurrent readers of the same product join the read
  already in flight instead of each issuing their own. The cache key includes
  every ceiling, validator and hook that decides whether a value is valid, so a
  stricter caller is never answered from a permissive caller's entry.
- **Stale-if-error, with a cooldown** — opt in with `maxStaleMs` (default 0,
  fail closed). Inside the window an upstream failure is answered from the last
  good value with `source: 'stale-if-error'`; outside it the failure is raised.
  A cancelled caller always gets its cancellation, never stale data instead.
  After a failure answered from the window, `failureCooldownMs` (default 10000)
  serves stale without re-attempting upstream, so a burst does not each pay the
  budget again. **Worst-case added latency** on the outage path is one
  `(retries + 1) x timeoutMs` per upstream leg — 30 s at the defaults for the
  manifest, 60 s if the artifact is the failing leg — paid by the first request
  of each cooldown period, not by every request.
- **Freshness** — every result carries `fetchedAt`, `ageMs`, `source`,
  `releaseId`, `observedAt`/`observedAgeMs` (the newest observation in the
  release, `staleness.newest_as_of`), `evaluatedAt` (when the producer cut the
  release), the producer's own `publishedState` verbatim, and a `state` derived
  from the thresholds in force. Thresholds come from `product.freshness`, or —
  when it declares none — from the manifest's own `fresh_if_less_than_minutes` /
  `warning_if_at_most_minutes`, so an app need not hardcode a duplicate that can
  drift. With neither, `state` is `'unknown'` — never `'fresh'`. `source` and
  `state` are the only two staleness signals, and they answer different
  questions: how it was served, and how old it is.
- **Bounded cache** — one client holds at most `maxEntries` products (default 8)
  and at most `maxCacheBytes` of retained artifact bytes (default 32 MiB), least
  recently used evicted first, so a module-scoped client cannot grow without
  limit in a Worker isolate. `clear()` drops the whole cache and
  `clear(productId)` drops one product's entries.
- **Consumer gates** — `acceptManifest(manifest)` runs before the artifact is
  downloaded and `validate(data, manifest)` before the pair is cached. Either
  throwing refuses the release with `reason: 'rejected'`, and the refusal is
  never cached, so a bad release is re-checked rather than memoised.
- **Request-id propagation and header hygiene** — `context.requestId` is sent as
  `x-request-id` and `context.headers` is merged in, so a request-id middleware
  plugs in without this module generating ids. `accept`, `user-agent` and
  `x-request-id` are managed and cannot be overridden; `authorization`, `cookie`
  and `proxy-authorization` are dropped rather than forwarded; every URL is
  pinned to the configured origin and a redirect is an error. Single-flight
  means the joined callers are answered by a request carrying the first caller's
  id.

Failures are a `NardukDataError` carrying `reason` (`aborted` | `checksum` |
`http` | `network` | `rejected` | `schema` | `timeout` | `too-large`), `status`
and `url`. A schema failure is an error state, not a silent pass-through, and an
empty-but-valid artifact stays distinct from a missing or stale one.

`schema` and `manifestSchema` are any validator with a zod-shaped `safeParse`,
so an app's existing zod schemas plug in and this package adds no validator
dependency of its own. The manifest read has its own ceiling
(`manifestMaxBytes`, default 256 KiB) independent of the artifact's `maxBytes`
(default 16 MiB).

### Before / after: a real Buoys call site

Buoys' `apps/web/server/api/stations/index.get.ts` reads the published
`buoy-status-v1` product. **Before**, the route's
`readCachedPublishedBuoyStatus` came from an app-owned
`server/utils/buoy-status-product.ts` that hand-rolled the whole path — a
hardcoded `https://data.nard.uk`, its own manifest fetch, a 15-second
`AbortSignal.timeout`, a bounded body read, a SHA-256 comparison, a 60-second
memo and an in-flight promise — roughly 120 lines before any buoy-specific
shaping:

```ts
// server/utils/buoy-status-product.ts (app-owned, abridged)
const DATA_ORIGIN = 'https://data.nard.uk'
export const MANIFEST_URL = `${DATA_ORIGIN}/buoy-status-v1/current/manifest.json`

async function fetchJson(fetcher: typeof fetch, url: string) {
  const response = await fetcher(url, {
    headers: {
      accept: 'application/json',
      'user-agent': PUBLISHED_DATA_USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`… failed with ${response.status}.`)
  return response
}

export async function readPublishedBuoyStatus(fetcher: typeof fetch = fetch) {
  const manifest = manifestSchema.parse(
    await (await fetchJson(fetcher, MANIFEST_URL)).json(),
  )
  const artifactBytes = await readBoundedBody(
    await fetchJson(fetcher, artifactUrl(manifest.releaseId)),
  )
  if (
    (await sha256Hex(artifactBytes)) !== manifest.artifact.sha256.toLowerCase()
  ) {
    throw new Error('… checksum does not match its immutable manifest.')
  }
  return {
    manifest,
    product: productSchema.parse(
      JSON.parse(new TextDecoder().decode(artifactBytes)),
    ),
  }
}

export async function readCachedPublishedBuoyStatus(
  fetcher = fetch,
  cache = sharedBuoyStatusCache,
) {
  const memo = cache.entry
  if (memo && memo.expiresAt > cache.now()) return memo.value
  cache.inFlight ??= readPublishedBuoyStatus(fetcher)
    .then((value) => {
      cache.entry = { expiresAt: cache.now() + cache.ttlMs, value }
      return value
    })
    .finally(() => {
      cache.inFlight = null
    })
  return cache.inFlight
}
```

**After**, the same util is a product declaration plus a client instance. The
route body is unchanged, and it gains freshness metadata, a retry it never had,
an explicit stale window it can opt into, and the manifest/artifact URLs the
app's `MANIFEST_URL` export exists to provide. It declares no `freshness`
thresholds because the published `buoy-status-v1` manifest carries its own:

```ts
// server/utils/buoy-status-product.ts (after)
import {
  createNardukDataClient,
  type NardukDataRequestContext,
} from '@narduk-enterprises/narduk-core/server/utils/narduk-data'

const client = createNardukDataClient({ userAgent: PUBLISHED_DATA_USER_AGENT })

const buoyStatusProduct = {
  artifactPath: 'public-buoy-data.json',
  manifestSchema,
  maxStaleMs: 10 * 60_000,
  productId: 'buoy-status-v1',
  schema: productSchema,
  ttlMs: 60_000,
} as const

export async function readCachedPublishedBuoyStatus(
  context?: NardukDataRequestContext,
) {
  const { artifactUrl, data, freshness, manifest, manifestUrl } =
    await client.read(buoyStatusProduct, context)
  return { artifactUrl, freshness, manifest, manifestUrl, product: data }
}
```

```ts
// server/api/stations/index.get.ts — unchanged
const { product } = await readCachedPublishedBuoyStatus()
const data = listPublishedStations(product, result.data)
```

The adoption itself is a Buoys-side change and is not part of this package's
release; the snippet above is the shape it takes.

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
