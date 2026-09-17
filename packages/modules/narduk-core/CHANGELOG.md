# @narduk-enterprises/narduk-core

## 2.1.0

### Minor Changes

- 9051c12: Ship the estate error page and a shared exception-capture seam, so
  every app that pins narduk-core gets both with no file of its own.

  **The error page reaches apps through Nuxt, not through a copy.** The module
  sets `app.errorComponent` from the `app:resolve` hook. Nuxt's own
  `resolveApp()` assigns that field immediately before calling the hook — an
  `app/error.*` from the project or any layer when one exists, and otherwise
  Nuxt's built-in `nuxt-error-page.vue` — so replacing only the built-in leaves
  an app-owned error page winning and needs no shim, no generator copy and no
  upgrade codemod. Apps install this package as a module rather than a layer,
  which is why `runtime/app/error.vue` was previously dead code: nothing
  referenced it and the layer-directory path Nuxt scans never reached it.

  The page now shows the **request id** — the same value `x-request-id` carries
  and the one every narduk-logging record is keyed by — resolved during SSR and
  transferred through the Nuxt payload, because a browser cannot read the
  response header of its own document. `requestLogger` also echoes the id back
  onto the incoming request headers so a re-entrant render of the failed page
  adopts it rather than minting a second one. It adds copy for 429 and 503,
  `data-testid` hooks for E2E, and a diagnostic detail line gated on
  `previewSafeMode` so a raw error message never reaches production traffic.

  **Exception capture is one seam.** A client plugin (`vue:error`, `app:error`)
  and a Nitro plugin (`error`) publish one report per error on a
  `narduk:exception` hook carried on the runtime's own bus. Reports carry the
  route _pattern_ — never a raw path — plus the build version, request id and
  status code, with query strings and email addresses redacted out of the
  message. Duplicate announcements are collapsed: `vue:error` and `app:error`
  both fire when a component failure is escalated, and Nitro can announce one
  handled error twice.

  Neither plugin logs. narduk-logging already writes exactly one record per
  failing request (narduk-libs#359), so a record here would double every server
  error. Server records now also carry `buildVersion`.

  New export `@narduk-enterprises/narduk-core/app/error-page` for an app that
  wants to wrap the page rather than fork it.

- 97b0ac3: Add `registerFreshnessCheck` — a shared data-freshness health check,
  so an app that serves published data can report how stale that data is instead
  of looking perfectly healthy while its feed has gone quiet.

  **The gap.** `/api/health` proved the app was answering and the database was
  reachable. Nothing on the health contract could say "the last observation this
  app publishes is nine hours old". Buoys already computes that age
  (`product.freshness`, `manifest.staleness`) and publishes it as inert `detail`
  on its `publication` check — "Source age describes the publication, not this
  viewer's availability" — because the only two outcomes available were pass and
  HTTP 503, and a stale marine feed is neither.

  **The helper.**

  ```ts
  registerFreshnessCheck({
    name: 'observations-freshness',
    source: 'ndbc-realtime-observations',
    warnAfter: 45 * 60, // seconds
    failAfter: 6 * 60 * 60, // seconds, optional
    async read({ signal }) {
      const { product } = await readPublishedProduct({ signal })
      return {
        at: product.freshness.asOf,
        detail: { releaseId: product.releaseId },
      }
    },
  })
  ```

  It publishes one `checks` entry carrying a stable `kind: 'freshness'`, plus
  `detail.source`, `detail.observedAt`, `detail.ageSeconds`,
  `detail.warnAfterSeconds` and `detail.failAfterSeconds`. `observedAt` and
  `ageSeconds` are published while the check is passing too, so a dashboard can
  plot age before anything is wrong. `at` accepts a `Date`, an ISO 8601 string
  or epoch milliseconds, and `now` injects the clock for tests.

  **The rollup.** Past `warnAfter` the entry fails with `required: false`, so
  the report is `degraded` and `/api/health` still answers HTTP 200 — a stale
  feed does not take the app down. Past `failAfter` it fails with
  `required: true`, so the report is `error` and the route answers 503. A check
  registered without `failAfter` can never reach that state. It **fails
  closed**: a missing timestamp, an unparseable one, a `read` that throws and a
  `read` that times out all fail at the strongest severity the thresholds allow,
  with `detail.reason` saying which, and never pass for want of evidence. A
  timestamp in the future is never stale; producer clock skew shows up as a
  negative `ageSeconds`.

  **No new status vocabulary.** The report keeps `ok`/`degraded`/`error` and
  each entry keeps `result: 'pass' | 'fail' | 'skipped'`. A check that can fail
  at two severities returns `{ ok: false, severity: 'degraded' }` from `run`,
  which is published as that entry's existing `required` flag, so
  `summarizeHealthStatus` is unchanged and every consumer that already derives
  the rollup from `required` stays correct. A check declared `required: false`
  can never escalate itself into an HTTP 503.

  **Compatibility.** Additive only. `kind` is omitted for every check that does
  not declare one, `severity` is an input to `run` rather than a response field,
  and an app that registers no freshness check gets a byte-identical
  `/api/health` body. `registerHealthCheck` also accepts an optional `kind` now,
  validated as 1-32 lowercase letters, digits or hyphens.

  **Watch the monitor.** An uptime monitor that matches the `"status":"ok"`
  substring alerts on `degraded` as well as on `error`, because the substring is
  simply absent. That makes `warnAfter` an alerting threshold, not just a
  dashboard one; the README's "Monitoring the endpoint" section now says so.

- fff943d: Add `defineRateLimitedHandler`, a per-route rate limit an app opts
  into by wrapping one handler — so no app writes its own limiter and no app
  edits this package's closed `RATE_LIMIT_POLICIES` registry to limit a route it
  owns.

  Both layers run and a denial from either answers 429. The Cloudflare Rate
  Limiting binding goes first where the app declared a matching top-level
  `ratelimits` entry, because its counters are coordinated per Cloudflare
  location rather than per isolate. An in-isolate fixed window always runs too:
  the binding's `.limit()` resolves to `{ success }` with no remaining count and
  no reset instant, so it cannot produce the `RateLimit-*` headers; its `period`
  accepts only 10 or 60 seconds, so it cannot express any other window; and it
  is a `workerd` primitive with no documented local-dev simulation, so it is
  absent in `nuxt dev`, in unit tests and under plain Node.

  The binding is an upgrade, never a prerequisite. Cloudflare's documentation,
  its GA changelog entry and the Workers pricing page are all silent on whether
  the binding is available on the Workers Free plan, so an app on Free adopts
  the helper with no wrangler change and can add the binding later without
  touching route code.

  A denial answers `Retry-After`, `RateLimit-Remaining: 0`, the request's
  `x-request-id`, and one structured warning through
  `@narduk-enterprises/narduk-logging` keyed on the matched route template
  rather than the raw path. `/api/health`, `robots.txt` and the sitemap surfaces
  are never limited, query string included, because a 429 on a health probe
  reads as an outage and a throttled crawler is an SEO self-injury.

  Response headers follow draft-ietf-httpapi-ratelimit-headers-11, which
  specifies `RateLimit-Policy` and `RateLimit` as Structured Fields rather than
  the `RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset` triad that
  earlier revisions defined and that deployed APIs actually ship; both families
  are emitted by default and the choice is configurable.

  `runtimeConfig.nardukRateLimit` carries the defaults plus per-key `routes`
  overrides that win over what a route declared, so an operator can retune an
  allowance without a code change. Existing `enforceRateLimitPolicy` callers are
  unaffected; `CloudflareRateLimitBinding` keeps its export from
  `runtime/server/utils/rateLimit.ts`.

- b94ac04: Add `setCacheProfile`: typed edge-cache profiles, so apps stop
  hand-writing `Cache-Control` strings per route.

  The strings were not merely repetitive, they were wrong. `buoys` has three of
  them and all three pair `s-maxage` with `stale-while-revalidate`. `s-maxage`
  _disables_ stale-serving — RFC 9111 §4.2.4, and Cloudflare's Workers Caching
  docs state it outright: "If your response includes any of `s-maxage`,
  `must-revalidate`, or `proxy-revalidate`, the stale-serving behavior is
  disabled". The 900s, 1800s and 86400s stale windows those three strings
  advertise do not exist. A hand-written header string has nothing to catch
  that; a typed profile does.

  `setCacheProfile(event, 'live' | 'slow' | 'static' | 'none' | inline)` emits
  the split pair Cloudflare documents for this case instead: the browser window
  on `Cache-Control: max-age` and the longer edge window on
  `CDN-Cache-Control: max-age`, with `stale-while-revalidate` intact on both.
  `CDN-Cache-Control` is the middle rung of Cloudflare's precedence
  (`cloudflare-cdn-cache-control` > `cdn-cache-control` > `Cache-Control`) and
  is respected by Cloudflare _and_ passed downstream, so the edge TTL stays
  visible while debugging. Nothing in the library ever emits `s-maxage`, and a
  test asserts that across every profile.

  The three named profiles carry Buoys' existing numbers, so a migrating app's
  browser TTLs are byte-identical before and after; only the edge behavior is
  repaired. `runtimeConfig.cache.profiles` overrides the seconds of any profile
  per app, ignoring negative, fractional and non-numeric values.

  An optional `tags` array emits `Cache-Tag` for purge-by-tag, validated against
  Cloudflare's contract — printable ASCII, no spaces or commas, 1024 characters
  per tag, 1000 tags per response, case-insensitive dedupe to match
  case-insensitive purge matching. Invalid tags are dropped rather than
  throwing, which is what the platform does at storage time. Purge by tag is
  available on every plan (Enterprise-only until 2025-04-01), so no
  purge-everything fallback is needed.

  `vary` merges with any `Vary` another handler already set, deduplicating
  case-insensitively while preserving the first spelling.

  `setCacheProfile` refuses to emit a cacheable posture — falling back to
  `private, no-store` with no `Cache-Tag` — when the response status is >= 400,
  when a `Set-Cookie` is already present, when `Vary: *` (which Cloudflare
  treats as uncacheable regardless), or in `previewSafeMode`. None of those are
  configurable, and the returned result names which guard fired.

  One caveat worth reading the README section for: Workers run _before_ the
  cache, so none of these edge headers bind until an app opts into Workers Cache
  with `"cache": { "enabled": true }` in its Wrangler config (Wrangler >=
  4.69.0). Until then the browser `Cache-Control` is still correct and the edge
  headers are inert. Workers Cache also partitions by Worker version by default,
  so a deployment already starts from a cold cache — a release is visible
  immediately with nothing to purge.

- 894cd17: Add the opt-in `security.headers` preset, which wraps `nuxt-security`
  with estate defaults: a nonce-based Content-Security-Policy,
  `Strict-Transport-Security`, `form-action`, `upgrade-insecure-requests`, a
  violation report route that logs through narduk-logging at `warn`, and a
  per-app allowlist for the `script`, `connect`, `img`, `font`, `style`,
  `frame`, `worker` and `media` directives.

  narduk-core already served security headers on every app taking the module's
  default `server: true` — `runtime/server/middleware/securityHeaders.ts` is
  picked up by `addServerScanDir`, and production Buoys was verified on
  2026-09-17 serving an enforcing CSP, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy` and `X-Content-Type-Options`. The gaps this closes are
  HSTS, the nonce (the legacy `script-src` carries
  `'unsafe-inline' 'unsafe-eval'`), a report-only soak path, a violation sink,
  and a module-level allowlist.

  The preset is additive, and the default is `off`, so **upgrading changes no
  app's headers**. With `enabled: true` the legacy enforcing CSP keeps being
  served and the strict nonce policy soaks beside it as
  `Content-Security-Policy-Report-Only`; `enforce: true` promotes the strict
  policy and retires the legacy one. Serving both during the soak is what avoids
  downgrading an already-enforcing app to report-only.

  `nuxt-security` is an **optional peer dependency**: an app that never enables
  the preset installs nothing extra. It was chosen over a hand-rolled Nitro
  handler because it is maintained (2.6.0, 2026-05-12, MIT), targets Nuxt 4 via
  `@nuxt/kit ^4`, and its runtime imports no Node builtin, using only
  `crypto.subtle`, `crypto.getRandomValues`, `btoa` and `TextEncoder` — all
  workerd APIs. Its non-header features (`csrf`, `corsHandler`, `rateLimiter`,
  `xssValidator`, `requestSizeLimiter`, `allowedMethodsRestricter`, `basicAuth`)
  are all disabled, as are `removeLoggers` and `sri`, which upstream defaults on
  and which change bundle and build behaviour a headers preset has no business
  changing.

### Patch Changes

- 57ba098: Record the three published `dependencies` floors narduk-core raised
  to reach the estate security bar. All three are runtime `dependencies`, so the
  fix only reaches a consumer through a release; none of them is a widening, and
  none crosses a major.

  `undici` `^8.1.0` → `^8.9.0` closes GHSA-4cwx-7wf7-3272 (high, "cross-user
  information disclosure and parse-time crash via degenerate private cache
  directives", vulnerable `>=8.0.0 <8.9.0`). `8.9.0` also closes four moderates
  on the same range: GHSA-8xcm-r25x-g524 (retry-interceptor response
  desynchronization), GHSA-jr45-8vmc-qm54 (whitespace around equals in
  `Cache-Control`), GHSA-m8rv-5g2x-5cg5 (CRLF injection via a blob-like body
  `type`) and GHSA-v3r7-h72x-cjcm (cookie attribute injection). `8.9.0` is a
  minor inside the already-declared `^8` major, and narduk-core's call sites —
  `fetch`, `Agent`, `ProxyAgent` and `setGlobalDispatcher` — are unchanged
  across it.

  `postcss` `^8.5.14` → `^8.5.18` closes GHSA-r28c-9q8g-f849 (high, "Path
  Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to
  Arbitrary .map File Disclosure", vulnerable `<=8.5.17`). A moderate on the
  same package, GHSA-fxqj-rqcc-2cmp (`<=8.5.22`, incomplete fix of
  GHSA-6g55-p6wh-862q), is below the bar and stays open at this floor.

  `@nuxt/image` `^2.0.0` → `^2.1.0` is what closes the two high `sharp`
  advisories, GHSA-f88m-g3jw-g9cj (libvips CVE-2026-33327, CVE-2026-33328,
  CVE-2026-35590, CVE-2026-35591, fixed in `0.35.0`) and GHSA-rgj7-g3m4-5g8c
  (libheif GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545, fixed in `0.35.4`).
  `sharp` reaches narduk-core only through `@nuxt/image`'s optional `ipx`:
  `@nuxt/image@2.0.0` pairs with `ipx@3.1.1`, which declares `sharp: ^0.34.3`
  and resolved to the vulnerable `0.34.5`; `@nuxt/image@2.1.0` pairs with
  `ipx@4.0.0-beta.1`, which declares `sharp: ^0.35.3` and resolves to `0.35.4`.
  Raising the floor is therefore load-bearing, not cosmetic — leaving `^2.0.0`
  in place lets a fresh lockfile resolve back onto the vulnerable `sharp` line.
  `sharp@0.35` raises its Node floor to `>=20.9.0`; the estate runs Node 24, and
  `ipx` is optional, so no supported consumer loses a platform.

  `pnpm audit --audit-level high` reports zero high or critical advisories at
  this floor.

- 57ba098: Declare `@nuxt/schema` as a peer dependency in every package whose
  **published** files name it. It was a phantom dependency in all four: declared
  only as a `devDependency`, while the shipped artifact imports it by bare
  specifier — narduk-core's `src/module.ts` (published through `files`),
  narduk-logging's `dist/nuxt.d.ts`, narduk-realtime's `dist/module.d.ts`, and
  narduk-mapkit-nuxt's `dist/module.d.mts` and `dist/types.d.mts`.

  Nothing supplied it to a consumer. `@nuxt/kit@4.5.2` imports `NuxtModule` from
  `@nuxt/schema` in its own `index.d.mts` but declares no `dependencies` entry
  for it and no peers at all, so resolution worked only through pnpm's hidden
  `node_modules/.pnpm/node_modules` hoist or a flat npm/yarn install. A consumer
  on pnpm with a restricted `hoist-pattern`, or a `node-linker` setting that
  suppresses that hoist, got `TS2307: Cannot find module '@nuxt/schema'` when
  type-checking against these packages.

  Rewriting the import to `nuxt/schema` — a subpath of the already-declared
  `nuxt` peer — was tried and rejected. narduk-realtime has no `nuxt`
  devDependency, so `tsc` fails with TS2307 against `nuxt/schema` until one is
  added, and narduk-logging declares no `nuxt` peer at all (its Nuxt entry point
  rests on an optional `@nuxt/kit` peer), so `nuxt/schema` would have been
  exactly as undeclared there as `@nuxt/schema` is today. A `dependencies` entry
  was rejected too: the repo augments `@nuxt/schema`'s interfaces, so the
  consumer must resolve the same instance its own Nuxt does, which only a peer
  guarantees.

  Each range mirrors the package's existing Nuxt peer — `>=3.16.0` for
  narduk-core and narduk-realtime, `>=4.0.0` for narduk-mapkit-nuxt, and
  `^4.0.0` for narduk-logging, matching its `@nuxt/kit` peer. narduk-logging's
  is **optional**, exactly as its `@nuxt/kit` peer is, so a consumer using only
  the node, browser or h3 entry points installs nothing extra. `@nuxt/schema`
  ships as a dependency of `nuxt` itself, so any Nuxt app already has a
  satisfying copy and this declaration adds no install.

  No source file changes: the explicit `NuxtModule` annotations that solved
  TS2742 are untouched, and the emitted types are byte-identical.

- Updated dependencies [3ab7ff2]
- Updated dependencies [119042d]
- Updated dependencies [57ba098]
  - @narduk-enterprises/narduk-logging@0.1.1

## 2.0.0

### Major Changes

- 8abb3c8: Move the Pinia stack to `pinia` 4 and `@pinia/nuxt` 1 in one step.
  narduk-core now depends on `pinia` `^4.0.3`, `@pinia/nuxt` `^1.0.2` and
  `@vue/devtools-api` `^8.1.5`. Pinia 4 no longer installs `@vue/devtools-api`
  for you, so narduk-core now lists it.

  Store APIs do not change. Pinia 4's breaking changes are all packaging:

  - it is ESM-only;
  - it requires `@vue/devtools-api` 8 installed alongside it;
  - its optional TypeScript peer is now `>=5.6`.

  `@pinia/nuxt` 1.0 has no option or runtime changes. It now carries its own
  `@nuxt/kit` `^4.4.8` and supports Nuxt `^3.15.0 || ^4.0.0 || ^5.0.0`.

  This is a major release because apps that list `pinia` themselves must move
  that pin at the same time. If an app keeps `pinia` 3, it installs two Pinia
  copies. `@pinia/nuxt` then creates and installs the Pinia instance from one
  copy, while the app's `defineStore()` comes from the other. Each copy has its
  own injection symbol and active instance. In a production client bundle, the
  first store call throws `Cannot read properties of undefined (reading '_s')`.
  The page then renders the error page and reports hydration mismatches, as seen
  in buoys#75.

  Consumer migration:

  - Adopt this narduk-core together with every other `@narduk-enterprises/*`
    package from the same release. Update any `pnpm.overrides` entry that pins
    narduk-core too.
  - If the app lists `pinia`, move it to `^4.0.3` in the same change. If it
    lists `@pinia/nuxt`, move it to `^1.0.2`. An app that never imports from
    `pinia` directly can drop that dependency and use the auto-imports.
  - If the app uses `@pinia/testing`, move it to `^2`. Version 2 is ESM-only and
    needs `pinia >=4.0.2`.
  - Import `pinia` only through ESM `import`, because there is no CommonJS
    build.
  - After installing, `pnpm-lock.yaml` must contain exactly one `pinia@4`
    snapshot and no `pinia@3` or `@pinia/nuxt@0.x` entry. Two `pinia@4.0.3`
    snapshots with different peer suffixes are still two runtime copies.
  - Before merging, run the app's hydration and store-backed E2E specs against a
    production build. The failure only shows up in the built client bundle.

### Minor Changes

- 8f693b1: Pin `@nuxt/ui` at `4.8.1` everywhere the layer pins it: the
  `narduk-core` dependency, the `narduk-shell` peer and dev pins, the
  `narduk-ai` and `design-system-build` dev pins, and the `create-narduk-app`
  generator manifest.

  `@nuxt/ui` 4.6.1 added `build.transpile.push('reka-ui')` (nuxt/ui#6286), which
  makes Vite bundle `reka-ui` per importer on the server as well as the client.
  Without it, an app that also declares `reka-ui` directly renders SSR markup
  from its own copy while hydrating against Nuxt UI's pinned copy, which
  produced the `Hydration node mismatch` failures in buoys. 4.8.1 also carries
  the fix for GHSA-gj2h-2fpw-fhv9 (medium, `@nuxt/ui < 4.8.1`) and widens the
  `typescript` peer to `^5.6.3 || ^6.0.0`. The only breaking change between
  4.6.0 and 4.8.1 is `UInputMenu`'s `autocomplete` prop being renamed to `mode`,
  which nothing in this workspace uses.

  Consumer migration: an app that declares `@nuxt/ui` itself must move its own
  pin to `4.8.1` in the same change that takes this release. `narduk-shell`'s
  peer is exact, so any other version is a peer conflict, and `narduk-core`
  carries `@nuxt/ui` as a dependency, so a different app-level pin resolves a
  second copy — the duplicate-copy failure this release removes.

## 1.25.0

### Minor Changes

- 2e9d424: Let apps run without a database and extend `/api/health` with their
  own checks.

  - Add the `databaseBackend` module option: `'d1'`, `'postgres'` or `'none'`.
    It takes precedence over `NUXT_DATABASE_BACKEND`; an app that sets neither
    keeps the D1 default. With `'none'`, `/api/health` reports
    `database: "not_applicable"`, `useDatabase` throws an HTTP 500 that names
    the declaration, and a bearer API key authenticates nobody.
  - Add `registerHealthCheck` for named required or optional checks. The health
    response gains a `checks` array listing the built-in `database` and
    `auth-tables` probes and every registered check. Existing fields keep their
    names and values.
  - Probe D1 apps without narduk-auth with `SELECT 1`. They previously ran the
    auth-table lookup and reported `schema_error`.
  - Send `Cache-Control: no-store` on `/api/health`.

  **Behavior change: `/api/health` answers HTTP 503 when `status` is `error`.**
  It previously answered 200 for every status. `degraded` still answers 200. A
  monitor that treats any 200 as healthy now sees failures, and a client that
  throws on non-2xx responses, such as `$fetch`, must catch the 503 to read the
  report.

  **Behavior change: a declared D1 database without its `DB` binding is `error`
  (503).** It was `degraded`. This applies when the app sets `databaseBackend`
  by module option, `NUXT_DATABASE_BACKEND` or `runtimeConfig`; an app that
  declares nothing keeps `degraded`.

  **Build failure: `databaseBackend: 'none'` with
  `@narduk-enterprises/narduk-auth` fails the build** with a message naming the
  conflict, because narduk-auth stores users, sessions and API keys in the app
  database.

## 1.24.0

### Minor Changes

- 54577ac: Export `getClientIp` from `server/utils/client-ip` so consuming apps
  attribute rate limits, lockouts and audit rows to the same address the layer's
  own rate limiter uses, instead of re-implementing it (or, as mybo-at-v2#30
  did, reaching for h3's `getRequestIP`, which never reads `cf-connecting-ip`
  and with `xForwardedFor: true` trusts the first forwarded entry — the one
  Cloudflare leaves as the client wrote it).

  Order: `cf-connecting-ip`, then the first `x-forwarded-for` entry **only when
  `trustForwardedFor` is set**, then h3's own view of the socket. `rateLimit.ts`
  now calls it with `trustForwardedFor: true` so its behaviour is unchanged; new
  consumers get the safe default.

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

### Patch Changes

- 548fa01: Deprecate `AppEmptyState`; it is removed in the next major.

  Use `NeStatePanel` from `@narduk-enterprises/narduk-shell` instead
  (narduk-libs#254, components-library backlog item 7; standing decision D4,
  Logan 2026-09-11: "Deprecate, remove next major").

  `AppEmptyState` can only say "nothing here". It cannot tell **unknown** from
  **zero**, which is the distinction its callers actually need and the bug class
  behind operator-portal#183, #162, #100 and #21. `NeStatePanel` carries five
  readings — `empty`, `loading`, `error`, `blocked`, `absent` — gives each the
  right ARIA role by construction, and never signals the reading with colour
  alone.

  The empty-state markup, props and rendered output are unchanged, so nothing
  breaks on this release. A one-time, dev-only `console.warn` points at
  `NeStatePanel`; production stays silent. The `@deprecated` JSDoc and the
  README section carry the one-for-one migration mapping (`description` becomes
  `message`, the default slot becomes `#action`, and the panel takes an explicit
  `state="empty"`).

- 960479a: Amend the `AppEmptyState` and `AppConfirmModal` deprecation warnings
  to say their `@narduk-enterprises/narduk-shell` replacements (`NeStatePanel`,
  `NeConfirmDialog` / `useConfirm()`) are currently pre-1.0, so a consumer can
  weigh the migration honestly against a hard "removed in the next narduk-core
  major" commitment (narduk-libs#282 review). Behaviour, the once-per-process
  warning guard, and the dev-only production silencing are unchanged.

  Also consolidates the package README's two separate deprecation sections
  ("Deprecated components" near the top, "Deprecations" near the bottom) into
  one "Deprecated components" section at the end of the document, so both
  `AppEmptyState` and `AppConfirmModal` migration guidance is discoverable in
  one place instead of split around unrelated Media security policy, Database
  alias contract, and List routes sections.

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

- 3a2b7b0: Deprecate `AppConfirmModal`; removed in the next major.

  Superseded by `NeConfirmDialog` / `useConfirm()` in
  `@narduk-enterprises/narduk-shell` (components-library backlog item 16,
  narduk-libs#263; decision D4, 2026-09-11: deprecate now, remove in the next
  narduk-core major).

  No behaviour change and no removal. The component gains an `@deprecated` JSDoc
  block and a one-time, dev-only `console.warn` pointing at `NeConfirmDialog` /
  `useConfirm()`. The call-site migration mapping — `v-model` → `v-model:open`,
  `confirmColor="error"` → `tone="danger"`, `loading` → `pending`, the default
  slot → `#body`, and the `icon` prop dropped — is in this package's README
  under "Deprecations".

- d606e70: Add `NeForm`, `NeFormSection` and `NeSettingsPage`
  (components-library backlog item 19, narduk-libs#266; backlog
  narduk-libs#247), and deprecate `narduk-core`'s `AppSettingsProfile`.

  `NeForm` wraps Nuxt UI's `UForm` with a save bar that does not lie, closing
  three named bug classes by construction:

  - **Double-submit (stonx#37).** A capture-phase `submit` listener on a real
    DOM ancestor of `UForm`'s `<form>` drops a second submit while the first is
    still in flight, so two rapid submits issue exactly one `onSubmit` call.
  - **A save bar that lies about dirtiness (stonx#36).** `Unsaved changes` is
    driven by `UForm`'s own `dirty` state, which only clears once `onSubmit`'s
    promise resolves — a rejected save leaves it dirty, with no optimistic
    "saved" flash to walk back.
  - **Errors that do not scroll into view (stonx#350).** A schema (or
    `validate`) failure blocks submission and focuses the first invalid field,
    scrolled into view.

  `UButton`'s own `loading-auto` drives the save button's spinner and disabled
  state for the duration of the `onSubmit` promise — no ref to wire.
  `NeFormSection` is a titled group of fields (a thin wrapper around
  `NeSectionHeader`); `NeSettingsPage` composes `NePageHeader` with a `NeForm`
  whose save bar is sticky by default, for a full settings screen built from one
  or more sections.

  Supersedes `narduk-core`'s `AppSettingsProfile`, deprecated in the same
  release (D4, Logan 2026-09-11: "Deprecate, remove next major"). No behaviour
  change and no removal: the component gains an `@deprecated` JSDoc block and a
  one-time, dev-only `console.warn` pointing at `NeSettingsPage`. The migration
  mapping is in narduk-core's README under "Deprecated components".

- Updated dependencies [0f45d4b]
- Updated dependencies [fdb9c15]
  - @narduk-enterprises/narduk-platform@2.1.0

## 1.23.2

### Patch Changes

- e202cfd: Disable analytics identifiers, loading, and replay on noncanonical
  Workers/Pages preview hosts and explicit nonproduction deployments. The same
  immutable version keeps production analytics when promoted to its canonical
  hostname.

  Avoid a client lifecycle warning while retaining noindex robots metadata on
  noncanonical hosts.

- 37c03e2: Publish the server-only module package Nuxt config fragment once as
  `@narduk-enterprises/narduk-core/nuxt-module-package-config`, and consume it
  from `narduk-tenancy`. A `packages/modules/*` package that ships no `app/`
  tree and sets no explicit `srcDir` keeps the package root as srcDir, so
  `nuxt typecheck` otherwise pulls `eslint.config.mjs` and the untyped `.mjs`
  sources of `@narduk-enterprises/eslint-config` into the type project
  (narduk-libs#176).

  Pin `create-narduk-app`'s own `prettier` devDependency to the one workspace
  version (`3.9.4`). Its published manifest declared the exact `3.8.3`, so a
  consumer installing it from the packed artifact — outside the workspace where
  `pnpm.overrides` applies — resolved a prettier that formats a multi-member
  union differently from CI, re-creating narduk-libs#175 one hop out.

## 1.23.1

### Patch Changes

- aaf5549: Change the shared PostHog session replay default to off. Apps can
  continue to opt in with `POSTHOG_SESSION_REPLAY_ENABLED=true`; the build
  default and Worker runtime overlay now agree.

## 1.23.0

### Minor Changes

- 6297a08: Route core logging through the shared Narduk Logging package while
  retaining old imports, calls, scopes and legacy verbosity. New generated apps
  configure service identity, info-level logging and request completion
  summaries explicitly.

## 1.22.0

### Minor Changes

- def589f: Add an opt-in cspMediaSrc configuration for video and audio origins,
  including blob-backed MSE playback, while retaining same-origin media by
  default.

## 1.21.0

### Minor Changes

- 0f2262a: Add `readApproximateLocation(event)`
  (`@narduk-enterprises/narduk-core/server/utils/approximateLocation`),
  narduk-libs#76 Wave 2's "Cloudflare approximate IP location helper".

  Reads the visitor's approximate location from whichever Cloudflare signal the
  runtime exposes — Nitro's `cloudflare_module` request-`cf` object (preferred;
  always populated on a real Cloudflare deployment) or the `cf-ip*` request
  headers a zone adds only when "Add visitor location headers" is enabled — and
  returns the same `{ label, lat, lon, source: 'ip' }` shape either way, or
  `null` when neither signal carries usable coordinates.

  Extracted from riverstatus `server/api/v1/location/approximate.get.ts`
  (`readCloudflareLocation`, request-`cf` reader) and borderwaitstat-us
  `server/api/geo/ip.get.ts` (`cf-ip*` header reader); the borderwaitstat-us
  version's Vercel-header fallback is app-specific migration cruft and was not
  carried over. This is the library half only — an app's own
  `server/api/.../*.get.ts` route still owns its URL path and response envelope
  and now calls this helper instead of reading Cloudflare signals itself;
  consumer migrations are tracked as follow-ups, not included in this change.

### Patch Changes

- 8b48dba: Move `@narduk-enterprises/eslint-config` out of narduk-core's runtime
  `dependencies`. Since 1.20.2 it was pinned there at `workspace:*`, which
  publishes as the current eslint-config major, so a patch bump of narduk-core
  silently dragged consumers from eslint-config v1 onto v2 and broke `lint` for
  anyone who hadn't migrated yet (narduk-libs#154, surfaced by been-sober-for PR
  #96).

  narduk-core re-exports `eslint-app-config.mjs` and
  `eslint-nuxt-flat-fragments.mjs`, which import from
  `@narduk-enterprises/eslint-config`, as public subpath exports for consumers'
  own ESLint configs, so it is not a pure `devDependency` — it is now an
  **optional peerDependency** (`>=1.2.17 <3`), matching the range of
  eslint-config majors the re-exported fragments are known to work with. It also
  stays a `devDependency` for narduk-core's own `lint`/`build`. Consumers who
  don't use those re-exported fragments no longer get eslint-config forced onto
  them at all; consumers who do must bring their own compatible eslint-config
  version instead of receiving whatever major narduk-core last published
  against.

## 1.20.5

### Patch Changes

- d6e098e: Fix two small bugs from the W2 hardening batch (narduk-libs#124):

  - `useAppFetch()` threw `useRequestFetch is not defined` when called from a
    consuming app, because it relied on a Nuxt auto-import that never resolves
    from `node_modules`. It now imports `useRequestFetch` explicitly from
    `#imports`, matching the pattern every other composable in this package
    already uses (narduk-libs#59).
  - Removed the orphaned `showcaseAuthLoginTest` rate-limit policy. Its only
    consumer, `useAuthApi().loginAsTestUser()`, was removed from narduk-auth in
    an earlier correctness pass, and the `/api/auth/login-test` endpoint it
    guarded has never existed in this repo (narduk-libs#96).

## 1.20.4

### Patch Changes

- 1d017c7: Persist sealed user-session cookies for 30 days by default so mobile
  browsers do not discard authentication when the browser is backgrounded or
  reclaimed. Callers can still provide a shorter or longer `maxAge` override.

## 1.20.3

### Patch Changes

- Updated dependencies [048670e]
  - @narduk-enterprises/eslint-config@2.0.1

## 1.20.2

### Patch Changes

- 95ec690: `@narduk-enterprises/eslint-config` v2: the estate lint config moves
  into narduk-libs (per HB-10 / D-DEMOTE-1 and narduk-libs#50), rebuilt for
  ESLint 10 on a replace-by-default basis — maintained third-party plugins
  wherever they cover the intent, 45 bespoke rules surviving out of 103 (every
  one with tests and no `testMode` bypasses), the proven-inverted hydration
  rules and dead Nitro security gates rebuilt against the executed deep-review
  proofs, legacy presets and the frozen nuxt-ui spec tier removed, and every
  code-corrupting autofixer gone. Consumer API (`createAppLintConfig`,
  `composeSharedConfigs`, the 14 capability packs) is signature-compatible;
  adopting v2 requires ESLint `^10` (peer). License corrected to UNLICENSED
  (D-PKG-5).

  **Three consumer-visible tightenings** land with the adversarial-hardening
  pass (full account in `DESIGN.md`):

  1. **Pack globs are nesting-safe.** `server/**`, `workers/**` and the auth
     pack's globs now match at any depth. A repository linted from an outer
     `cwd` — any monorepo, any app one level down, and every layer package's
     `runtime/server/**` — previously received **no** server or Cloudflare rules
     at all. Expect first-time findings in newly-covered trees. The two core
     rules the packs carry are gated out of `tests/**` and friends so the
     widening does not sweep in test code.
  2. **A route named like a test is a route.** `server/api/x.post.test.ts` is
     deployed by Nitro as `POST /api/x.post.test`, and the `.test.` infix no
     longer exempts it from the security tier. Inside a route tree only a real
     test or fixture _directory_ exempts a file. Move colocated route suites
     under `tests/` or `__tests__/`.
  3. **`no-restricted-imports` is order-independent.** All three contributing
     packs now assign one shared option, so a trailing `cloudflare` entry can no
     longer erase the relative-import and layer-source patterns — which it did
     for every consumer using `nardukTemplateStrictCapabilityPacks`. Those
     patterns start applying again. A portable Nuxt layer (no `#server/*` alias
     for its own sources) should assign the new
     `PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE` export to its server glob rather
     than switching the rule off.

  Also fixed in the same pass: five ways to walk past a security rule by
  renaming a binding (an aliased `defineEventHandler`, a runtime-derived HTTP
  method, `.raw` lifted off drizzle's `sql`, a destructured `db.query` receiver,
  and `limit: undefined`), and `no-legacy-overlay-model`'s blindness to
  camelCase `modelValue` bindings. Every one ships with the fixture that proved
  it as a regression test.

  Sibling packages: the shared config is now consumed via the workspace
  (`workspace:*`) and their `eslint` devDependency moves to `^10.8.0`. Adopting
  v2 also swept their stale `eslint-disable` comments onto the replacement rule
  ids and cleared the findings the fixed path gates newly surface. Three
  behaviour-neutral source edits came with that sweep: `narduk-core` adds
  `import.meta.client` early returns to three handlers that were already
  client-only (clipboard copy, share-link copy, avatar canvas resize);
  `narduk-auth`'s `runtime-public` endpoint drops a `process.env` merge layer
  that `readWorkerRuntimeEnv` already supplied and that the merge order
  discarded; and `narduk-app-tools` swaps one `split().join()` for
  `replaceAll()`. The five layer packages (`narduk-core`, `-auth`, `-seo`,
  `-ai`, `-uploads`) assign the portable-layer import rule in their own configs,
  and `narduk-core` and `-uploads` carry scoped, commented exceptions for the
  pre-existing conditions their newly-linted `runtime/server/**` trees surfaced.

- Updated dependencies [95ec690]
  - @narduk-enterprises/eslint-config@2.0.0

## 1.20.1

### Patch Changes

- e030789: Configure the local Lucide server and core-header client bundles
  before Nuxt UI installs its icon module, and generate the core module before
  Nuxt UI so that ordering remains deterministic in packed consumers.

## 1.20.0

### Minor Changes

- 7848187: Remove template composition and Command-only contracts from
  `narduk-platform`, retire core PWA and control-plane behavior, and source the
  SEO network directory from the independent catalog origin.

### Patch Changes

- 7848187: Replace the template-era dynamic database aliases with the private
  `#narduk-core/schema` and `#narduk-core/postgres-runtime` Nuxt contracts. Core
  now derives secure session-cookie defaults from the request protocol so local
  HTTP development remains usable while HTTPS stays secure. Auth's packaged
  runtime now imports its own composables and server helpers explicitly, with
  boundary checks that prevent implicit template-era auto-import dependencies
  from returning.
- 7848187: Keep known VueUse 14.3 annotation noise out of production build logs
  without hiding app-source warnings, and make packaged SEO routes and Takumi
  rendering self-contained in downstream Nuxt consumers.
- Updated dependencies [7848187]
  - @narduk-enterprises/narduk-platform@2.0.0
