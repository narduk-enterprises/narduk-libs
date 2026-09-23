# @narduk-enterprises/narduk-core

## 2.12.0

### Minor Changes

- 551e39a: The canonical-host redirect takes a host list:
  `CANONICAL_REDIRECT_HOSTS` (or `runtimeConfig.public.canonicalRedirectHosts`)
  redirects only the named hosts, such as `www`, to the canonical origin and
  serves every other host where it was asked, so `*.workers.dev` previews keep
  working. It needs no `ENFORCE_CANONICAL_HOST`, and a `*.workers.dev` entry is
  ignored (#515).

## 2.11.0

### Minor Changes

- 5747011: Three small narduk-core changes.

  - `readBoundedBody` and `readBoundedJson` are exported server utils
    (narduk-libs#565). They read an upstream body with a hard size ceiling,
    cancelling the stream once it passes `maxBytes`, and throw
    `BoundedBodyTooLargeError`, or your own error via `tooLarge`. The
    narduk-data client already read its bodies this way. The README documents
    it. An app with its own util of the same name gets a duplicate auto-import
    warning; delete the app's copy.
  - `x-build-version` reads `WORKERS_CI_COMMIT_SHA` before it asks `git`
    (narduk-libs#584). A Workers Build no longer depends on its checkout
    carrying `.git` to stamp the commit.
  - `defineRateLimitedHandler` given an async handler returns
    `EventHandler<Request, Promise<Response>>`, not `Promise<Promise<Response>>`
    (narduk-libs#653). Runtime behaviour is unchanged, and the cast in
    `definePublishedDataHandler` is gone.

- b0dca25: `LayerAppFooter` has an extension point for extra rows
  (narduk-libs#743). It renders an `after` slot below its content, and by
  default that slot renders the global components listed in
  `appConfig.nardukCore.footer.after`. A module can now add a footer row without
  shipping its own copy of the footer. The README documents it.
- 45ea540: `consumeRateLimit(event, options, path?)`:
  `defineRateLimitedHandler`'s decision step as a non-throwing verdict, for a
  route the app cannot wrap, such as a module's token route (#413). The wrapper
  now calls it, so the two share one counter key, store, binding and override
  surface.

  `shared/utils/units` adds knots (`metresPerSecondToKnots`,
  `knotsToMetresPerSecond`), the inverse of every existing conversion, and
  `compassPoint16(degrees)` with `NE_COMPASS_POINTS_16` (#518).

### Patch Changes

- 02b6c1a: The CSP report route answers 204 without reading any body that is not
  `application/csp-report` or `application/reports+json`, and limits each client
  to 60 reports a minute (rate-limit key `csp-report`); a request of any other
  type is answered before the limiter and never counts against it (#444).
- f395bd6: The shared imports block now sets `import-x/resolver-next` to
  eslint-plugin-import-x's own Node resolver (narduk-libs#562). With no resolver
  set, import-x fell back to its legacy `node` probe, which crashed
  `import-x/no-cycle` on a `vitest.config.ts` with "node with invalid interface
  loaded as resolver". An app that turned `import-x/no-cycle` off for its
  `vitest.config.ts` can drop that override. narduk-core and narduk-auth have
  dropped theirs.

## 2.10.1

### Patch Changes

- 0da668a: Core migration `0007_api_key_hash_index.sql` adds a unique index on
  `api_keys.key_hash` (#168). Every API-key authentication looks the key up by
  its hash, and without the index each one scanned `api_keys`, including a
  request presenting a well-formed but fabricated key. The D1 and Postgres
  schemas declare the same index. Apply it with the app's migrate script
  (`narduk-app db migrate`). A Postgres app adds it with its own DDL.
- 5ac629e: The seeded `@nuxt/icon` client bundle now includes `lucide:check`,
  `lucide:copy` and `lucide:link`, which `AppCopyButton` and `AppShareButtons`
  render. The build now warns when an app lists `@nuxt/icon` before narduk-core
  without setting `icon.fallbackToApi: false`: `@nuxt/icon` has then already
  installed with the Iconify API fallback, which an enforcing CSP refuses
  (narduk-libs#467). The README states the module order.
- 1759259: A thrown error answered as JSON now leaves `private, no-store`
  (narduk-libs#493). For an `/api/*` or `.json` path,
  `Accept: application/json`, a CORS fetch or curl, Nuxt hands the error to
  Nitro's own handler, which sent `Cache-Control: no-cache` on every 404 and
  bypassed the `error-cache` plugin. Workers Cache stores `no-cache`, so an app
  with `"cache": { "enabled": true }` stored its API errors. A new prepended
  Nitro error handler, `json-error-no-store`, answers those errors itself with
  Nitro's status and body and `private, no-store`, and strips any CDN headers a
  route set before it threw. HTML errors and `nuxt dev` are unchanged.
- Updated dependencies [5ac629e]
  - @narduk-enterprises/narduk-platform@2.1.1

## 2.10.0

### Minor Changes

- 056105e: Bump `@nuxt/ui` from `4.8.1` to `4.11.1` everywhere the layer pins
  it: the `narduk-core` dependency, the `narduk-shell` peer and dev pins, the
  `narduk-ai` and `design-system-build` dev pins, and the `create-narduk-app`
  generator manifest (following the same coordinated-pin pattern as 8f693b1).

  A consumer app already on `@nuxt/ui@4.11.1` (buoys#287) failed
  `nuxt typecheck` against narduk-core's `AppTabs.vue`:

  ```
  error TS2345: Argument of type '{ ... items: TabsItem[] | undefined; ... }' is
  not assignable to parameter of type '... items?: TabsItem[] | undefined; ...'.
    Type 'import(".../@nuxt+ui@4.8.1/.../Tabs.d.vue").TabsItem[] | undefined' is
    not assignable to type 'import(".../@nuxt+ui@4.11.1/.../Tabs.d.vue").TabsItem[]
    | undefined'.
  ```

  Two different `@nuxt/ui` installs (narduk-core's pinned `4.8.1` and the app's
  own `4.11.1`) produced structurally distinct `TabsItem`/`AvatarProps` types
  that TypeScript will not unify, even though both come from the same package
  name. Matching narduk-core's declared version to the app's removes the
  duplicate-copy mismatch.

  `nuxt typecheck` passes clean in narduk-core against `4.11.1` with no source
  changes; no other breaking change between `4.8.1` and `4.11.1` touched
  anything in this workspace.

  Consumer migration: an app that declares `@nuxt/ui` itself must move its own
  pin to `4.11.1` in the same change that takes this release. `narduk-shell`'s
  peer is exact, so any other version is a peer conflict, and `narduk-core`
  carries `@nuxt/ui` as a dependency, so a different app-level pin resolves a
  second copy -- the duplicate-copy failure this release removes.

  Refs narduk-enterprises/buoys#287.

### Patch Changes

- Updated dependencies [e61a56d]
  - @narduk-enterprises/narduk-logging@0.3.2

## 2.9.0

### Minor Changes

- 671fbf3: Adds `useCurrentLocation()`, a consent-first "near me" location read
  (#385). Nothing is read until `locate()` is called from a user gesture. Each
  call is one `getCurrentPosition`: it never watches, polls or reports a
  coordinate, and server rendering is a no-op.

  It keeps four failure outcomes apart. `denied` means the person refused.
  `blocked` means the page's own Permissions-Policy forbids geolocation;
  Chromium reports that as a denial, and the composable tells the two apart.
  `unavailable` means no position could be had, and `timeout` means none arrived
  in time.

  Fixes `NUXT_PUBLIC_ALLOW_GEOLOCATION` having no effect with the
  `security.headers` preset on. Before this change only the legacy middleware
  read it, so the app reported `allowGeolocation: true` and still sent
  `geolocation=()`. The preset now grants `geolocation=(self)` from it at build
  time. An explicit `permissionsPolicy.geolocation` still wins.

## 2.8.1

### Patch Changes

- df7568d: Stop published server code from depending on a consumer-side
  runtime-config augmentation.

  `narduk-core` ships raw `.ts`, and a consumer's Nitro type program types
  `useRuntimeConfig(event)` as `@nuxt/schema`'s `RuntimeConfig`
  (`Record<string, unknown>`). `useHyperdriveConnectionString` indexed
  `hyperdriveBinding || 'HYPERDRIVE'`, which is `{} | string` there, so every
  consumer failed with TS2538 while this package's own `nuxt typecheck` stayed
  green (narduk-libs#656, the same gap as #649). The legacy security-headers
  middleware had the same shape on `public.appVersion` and the `csp*Src` keys: a
  truthiness guard narrows `unknown` to `{}`.

  Server code that reads a key the module actually writes now goes through
  `coreRuntimeConfig(event)`. The type names only those keys —
  `hyperdriveBinding` and the public version, CSP, and geolocation defaults from
  `src/module.ts` — and leaves everything else `unknown`. A
  `tsconfig.consumer-server.json` project, run from the package's vitest suite,
  compiles the shipped `runtime/server/**` against that unaugmented view and
  fails if the view stops rejecting a direct `hyperdriveBinding` index.
  `create-narduk-app` is a companion patch so the generator pin moves with core.

## 2.8.0

### Minor Changes

- 62b7b79: New server util
  `definePublishedDataHandler(handler, { profile, tags?, vary?, fallbackMessage?, rateLimit? })`
  for public published-data reads (narduk-libs#514). It applies the cache
  profile only after the handler succeeds, so an error never advertises a
  cacheable posture. An internal failure without a `statusCode` is logged and
  answered with a sanitized 503, and a deliberate `createError` passes through
  unchanged. Rate limiting goes through `defineRateLimitedHandler` and is
  applied only when `rateLimit` is passed. It is auto-imported, so an app with
  its own `definePublishedDataHandler` in `server/utils` (Buoys) should replace
  its local copy when it adopts this release. `create-narduk-app` is a companion
  patch so the generator pin moves with this core minor.
- c574403: core: answer `HEAD` on file-based API routes

  h3's router matches the request method exactly, so a `*.get.ts` file route
  registers `handlers.get` and nothing else and every `HEAD` to an API path fell
  through to a 404 — including `/api/health`, the path apps enrol for uptime
  monitoring. A monitor probing with `HEAD`, the conventional choice for a
  liveness check, saw the app as down. RFC 9110 §9.3.2 requires `HEAD` to be
  identical to `GET` minus the body.

  A new server middleware answers `HEAD` on `/api` paths by re-entering the app
  with `GET` and returning that response's status and headers with no body, so
  the two cannot drift and a failing health check still surfaces as its real
  status rather than as a cheap `200`. Pages are untouched: the Nuxt renderer is
  bound to no method and already answers `HEAD`.

  The re-entering request carries the caller's identity. Headers already
  forwarded survive the hop untouched; a caller identified only by its socket
  has that address carried inward explicitly, because the inner request has no
  socket and would otherwise join every other `HEAD` in the single `'unknown'`
  rate-limit bucket. A client-chosen forwarded address is never promoted to the
  trusted identity header.

### Patch Changes

- cecc72a: Dedupe `parseListQuery`'s unknown-query-key warning per distinct key
  set instead of logging once per request.

  The tolerate-and-warn path (#257, shipped in #283) logged one structured
  `warn` line every time a request carried an unknown list-query key, with no
  dedupe, counter, or cache. Two of the three routes it covers have no rate
  limit ahead of it, so an ordinary authenticated session could force unbounded
  log volume — and the per-request hot-path cost that comes with it — just by
  appending one throwaway query parameter to every request (e.g.
  `GET /api/notifications?limit=20&x=1`).

  The warning now logs once per distinct unknown-key set per process,
  remembering at most 256 sets. Past that cap it emits exactly one final
  `list_query_unknown_keys_suppressed` notice and stops — it does not clear and
  resume — so a caller varying the throwaway key every request cannot reproduce
  one-log-line-per-request by pushing the memorized set past its limit. Memory
  stays bounded at 256 remembered sets, and total log lines are now at most 257
  per isolate, regardless of request volume. Only the key _names_ were ever
  logged, never values, so this was a log-volume issue, not an injection or
  leakage one.

- 62b7b79: Stop the unhandled `/api/_auth/session` SSR error in apps that have
  not configured auth (narduk-libs#540). `coreModules` still installs
  `nuxt-auth-utils` (dashboard chrome uses `useUserSession`), but passes the
  module's existing `auth.loadStrategy: 'none'` unless the app already set a
  strategy, has a session password (`NUXT_SESSION_PASSWORD`, `SESSION_PASSWORD`,
  or `runtimeConfig.session.password`), or lists `narduk-auth` /
  `nuxt-auth-utils` in `modules`. A no-auth fixture SSRs without that fetch and
  without an error log. `create-narduk-app` is a companion patch so the
  generator pin moves with core.
- 2671ccd: The production error sanitizer can no longer throw.
  `sanitizeProductionError` assigned `statusText` unguarded, and
  `'statusText' in error` is true for a getter with no setter, so the write
  threw in strict mode, escaped into Nitro's error handling, and turned a
  correct status into a 500 with the original error discarded. `message`,
  `statusMessage` and the `delete` of `data` and `cause` could fail the same
  way, with worse consequences.

  Every field is now scrubbed defensively, falling back to
  `Object.defineProperty` so an inherited accessor is shadowed by an own data
  property and the value is actually removed rather than merely not throwing.
  One field that resists both paths no longer aborts the rest of the pass.

- b672613: Declare `vue-router` as a peer dependency of narduk-core.

  `runtime/app/components/app/LayerAppHeader.vue` imports the type
  `RouteLocationRaw` from `vue-router`, and `runtime/` is in narduk-core's
  published `files`, so that bare specifier ships to every consumer. narduk-core
  declared `vue-router` nowhere — not in `dependencies`, not in
  `peerDependencies` — so it resolved only because `vue-router` is a dependency
  of `nuxt` (`^5.2.0` per `nuxt@4.5.2`'s own `package.json`), which every
  consumer has today. A pnpm install with a restricted `hoist-pattern`, or a
  `node-linker` setting that suppresses that hoist, would get
  `TS2307: Cannot find module 'vue-router'`.

  Same shape as the `@nuxt/schema` phantom dependency closed in #382 — it was
  found by that PR's published-surface scan and deliberately left out to keep
  that PR scoped (narduk-libs#383). The range mirrors what `nuxt@4.5.2` itself
  declares, so any Nuxt app already has a satisfying copy and this declaration
  adds no install.

  `@narduk-enterprises/create-narduk-app` moves in lockstep because it pins
  narduk-core's version in `PACKAGE_VERSIONS`.

  **Consumer impact.** `patch`, not `minor`: this declares a dependency that was
  already required at runtime for every consumer today (any app using
  narduk-core already brings in `nuxt`, which already brings in `vue-router` —
  narduk-core's own type import has always needed it to resolve), it does not
  add a new runtime requirement. A consumer already on `vue-router >=5.2.0` —
  which is every consumer today, since that is what `nuxt@4.5.2` itself pulls in
  — sees no change: no new install, no version bump forced on their lockfile, no
  new peer warning. A consumer on an older, unsupported `nuxt` that resolved a
  pre-5.2.0 `vue-router` would newly see a peer range warning on their next
  install, surfacing a version this package already silently depended on rather
  than creating a new one.

- Updated dependencies [7bfcf46]
  - @narduk-enterprises/narduk-logging@0.3.1

## 2.7.0

### Minor Changes

- 693f7d3: security.headers: let a first-party-only app opt out of the estate
  CSP baseline

  `security.headers.baseline` selects which third-party origins an app inherits
  before its own `allow` is applied. It defaults to `'estate'`, so no existing
  app's policy changes.

  `baseline: 'self'` inherits none of them: every directive is `'self'` plus
  whatever the app names in `allow`. It exists because `allow` can only add,
  which left an app reaching no third party unable to enforce the strict nonce
  policy without widening its CSP — trading `script-src 'unsafe-inline'` for the
  eleven `BASELINE_ALLOWLIST` origins, eight of them on `connect-src`.

  The nonce, `'strict-dynamic'`, HSTS, `frame-ancestors`, `form-action`,
  `object-src`, the report route and style-src's `'unsafe-inline'` are
  unchanged, and the resulting policy is a strict subset of the `'estate'` one.

  Closes #560.

## 2.6.4

### Patch Changes

- fa2f123: fix(narduk-core): put the base element styles in `@layer base` so an
  app's theme wins

  `main.css` is appended to `nuxt.options.css` after the consuming app's own
  stylesheets, and its `body` and `h1`–`h4` rules were unlayered. Unlayered CSS
  beats every layered rule regardless of source order, so those defaults could
  not be overridden by an app at all: measured on lakestat-us, the app's own
  `body { color: var(--gs-ink); background: var(--gs-page) }` lost, and the page
  computed `#fff`, slate-700 and Inter instead of the app's palette.

  Both rules now sit in `@layer base`, which is where Nuxt UI already ships the
  same body declarations. `.font-display` stays unlayered, because an app opts
  into that class by name rather than inheriting it.

## 2.6.3

### Patch Changes

- ecc731b: The report-only CSP no longer carries `upgrade-insecure-requests`.

  The preset already meant to keep that directive on the enforcing header only —
  browsers ignore it in a report-only policy, and Chromium logs a console error
  for every document load. It did that by leaving the key off its own config
  object, which is not the same thing: nuxt-security merges our options _over_
  its defaults (`defuReplaceArray(userOptions, defaultSecurityConfig(...))`),
  and its default CSP sets `'upgrade-insecure-requests': true`. defu fills in
  any key we leave undefined, so the directive came back at full strength and
  the README's documented contract — report-only "without
  `upgrade-insecure-requests`" — was never what shipped.

  The directive is now set explicitly to `false` in report-only mode. defu keeps
  a declared `false`, and nuxt-security's serializer drops a false directive
  rather than emitting it.

  Found on lakestat.us, where enabling the preset turned every page load into a
  console error and failed the app's visual-audit E2E suite (18 errors: 6 routes
  × 3 viewports). The unit test that covered this asserted the key was _absent_
  from our config object, which is exactly the state that let the default
  through — so `nuxt-security-contract.test.ts` now reproduces upstream's own
  merge with upstream's own code, rather than asserting on our half of it.

## 2.6.2

### Patch Changes

- 81051b0: Narduk Data client: send `redirect: 'manual'` instead of `'error'`,
  which the Cloudflare Workers runtime rejects before any response arrives. A
  redirect is still an `http` failure and is never followed (#563).

## 2.6.1

### Patch Changes

- 448e86f: `createNardukDataClient` no longer re-downloads an unchanged release
  when its TTL lapses. If the manifest still names the same release and artifact
  checksum, the client keeps the cached value (and its object identity) and
  fetches only the manifest.
- 7142305: `useSsrNow(key, { tickMs })` also re-reads the browser clock when the
  page becomes visible again, so a viewer returning to a background tab sees
  current relative ages at once instead of after the next (throttled) tick. The
  listener is registered only for a ticking clock and removed on unmount. This
  closes the last gap between `useSsrNow` and the Buoys map clock it
  generalises. `create-narduk-app` is a companion patch so the generator pin
  moves with the core patch.

## 2.6.0

### Minor Changes

- 4599aa7: `createNardukDataClient` can now read a release's secondary
  artifacts, the ones the manifest lists in `artifacts[]` beside the primary
  `artifact`. Set the new `NardukDataProduct.entryPath` option to a
  release-relative path, for example
  `consumer/lakes/texas/canyon-lake/history-1y.json`.

  - The path may have several segments, each of which must be a plain name.
  - The entry is checked against its own listed SHA-256, with the usual timeout,
    retry, single-flight, memo, stale-if-error and freshness handling.
  - A release that does not list the entry fails with the new `NardukDataError`
    reason `'missing'`, so consumers can answer "not published" rather than
    reporting an outage. It never falls back to the primary artifact.

  Reads without `entryPath` are unchanged (#552).

- 4ba5d02: AppLightbox gains optional thumbnail rails (0–2 labelled rails, each
  with its own keyboard axis) and a `side` slot for per-picture details.
  `AppImage` wraps remote pictures with loading and failed states.
  `AppSnapStrip` is a horizontal scroll-snap strip with an en-dash position
  readout (narduk-libs#529). `create-narduk-app` is a companion patch so the
  generator pin moves with the core minor.

## 2.5.0

### Minor Changes

- 8d35cb8: `useDatabase(event)` and `createAppDatabase` accessors now count D1
  round trips on narduk-logging's request counter (narduk-libs#511): one per
  `first` / `all` / `run` / `raw` on a prepared statement, and one carrying
  every statement for a `batch`. The counts reach `Server-Timing` and the
  "Request completed" record. Counting never fails a query.
- 8d35cb8: A response that leaves the app with no cache posture now ships
  `Cache-Control: private` (narduk-libs#435, step 1). SSR pages, API JSON, and a
  returned `Response` without its own header all get it. Any explicit posture
  wins unchanged: `Cache-Control`, `CDN-Cache-Control`,
  `Cloudflare-CDN-Cache-Control`, `Surrogate-Control` or `Expires` from
  `setCacheProfile`, `setResponseHeader`, route rules, cached handlers, or the
  returned `Response`. Build assets under `app.buildAssetsDir` are left alone,
  and thrown errors stay `private, no-store`. A route that relied on having no
  `Cache-Control` to be stored by a shared cache must now say so with
  `setCacheProfile`.

### Patch Changes

- 8d35cb8: The `./app/error-page` export now has a `types` condition
  (narduk-libs#521). The page is typed as a component taking `error: NuxtError`,
  so an app importing it into its own `app/error.vue` no longer needs
  `@ts-expect-error`.
- 92835a1: Fixes for the new error-severity lint rules. `LayerAppFooter`
  (narduk-core, narduk-seo) no longer reads `new Date()` during render for the
  copyright year; it reads one SSR-hydrated timestamp (`useSsrNow` in
  narduk-core, `useState` in narduk-seo), so server and client agree.
  `GET /api/auth/api-keys` (narduk-auth) is ordered newest first in SQL and
  limited to 100 keys, since nothing caps how many keys a user may create.

## 2.4.0

### Minor Changes

- bb37590: New auto-imported composable `useSsrNow(key, { tickMs? })`: a
  render-safe "now" for relative times. The server reads `Date.now()` once into
  `useState('narduk:now:<key>')`, the client hydrates with that same value (no
  hydration mismatch across a minute boundary), and after mount it switches to
  the browser clock, optionally re-reading it every `tickMs` and clearing the
  interval on unmount. Returns a readonly `Ref<number>`. It generalises Buoys'
  `useStationPageClock`, `map:now` and `stations:now`. The lifecycle half is
  also exported as `createSsrNowClock(stateRef, options)` from
  `./app/utils/ssrNowClock`.
- bb37590: New D1 migration `runtime/drizzle/0006_user_id_indexes.sql` adds
  `api_keys_user_id_idx` on `api_keys(user_id)` and `sessions_user_id_idx` on
  `sessions(user_id)` (`CREATE INDEX IF NOT EXISTS`). The Drizzle schema and the
  Postgres schema declare the same indexes.

  Why: `api_keys.user_id` is the only predicate of narduk-auth's
  `GET /api/auth/api-keys`, which scanned the whole table on every listing; the
  plan is now `SEARCH api_keys USING INDEX api_keys_user_id_idx`.
  `sessions.user_id` is not a query predicate (sessions are looked up by id),
  but it is the child column of `users ON DELETE CASCADE`, so each user delete
  scanned `sessions`; SQLite recommends indexing foreign-key child columns.
  `CREATE INDEX` holds D1 writes while it builds; both tables are small today.

  Consumer action: none beyond the normal migrate step. Apps generated by
  create-narduk-app list narduk-core's `runtime/drizzle` directory in
  `migrations.sources.json`, so after upgrading run `pnpm db:migrate:local`, and
  `cf:deploy` applies it remotely through `narduk-app db migrate --remote` in
  Workers Builds. An app that deploys another way must run its
  `db:migrate:remote` (or equivalent) before or with the deploy. Postgres apps:
  core ships no Postgres migrations, so add the two indexes with your own DDL.

## 2.3.0

### Minor Changes

- 8da7e33: Rate limiting and CSRF hardening.

  - Rate-limit counters key an IPv6 caller by its `/64` instead of the full
    address, in `defineRateLimitedHandler` (window and Cloudflare binding) and
    in `enforceRateLimit` / `enforceRateLimitPolicy`. IPv4 keys are unchanged;
    `getClientIp` still returns the full address (#430).
  - An `'ip-path'` route counts `/path/`, `/path?x=1` and a percent-encoded
    spelling in the same bucket as `/path` (#433).
  - New `shared/rate-limit-namespace` helper (`rateLimitNamespaceId`,
    `rateLimitNamespacePrefix`, `RATE_LIMIT_SCAFFOLD_NAMESPACE_IDS`) and README
    guidance: Cloudflare `namespace_id` is account-unique, so the pasteable
    `1001` example is gone (#433).
  - New `nardukCore.csrf.exemptPaths` option lets an app declare credential-free
    device routes CSRF-exempt (exact paths or `/prefix/*`); over-broad or
    ambiguous entries fail the build and are ignored at runtime (#239).
  - The CSP report route exemption also accepts the trailing-slash and query
    spellings the router dispatches to it (#415).

- 05b3ef9: Keep per-request headers off shared-cacheable responses
  (narduk-libs#412, narduk-libs#418). `setCacheProfile` now strips the
  `RateLimit-*` family (`RateLimit`, `RateLimit-Policy`, `RateLimit-Limit`,
  `RateLimit-Remaining`, `RateLimit-Reset`), `Retry-After`, `x-request-id` and
  `Server-Timing` whenever it emits a public profile (`live`, `slow`, `static`,
  or a non-private inline profile), so a route no longer has to pass
  `headers: 'none'` to `defineRateLimitedHandler` to be safe. A new
  `shared-cache-headers` Nitro plugin strips the same headers in
  `beforeResponse` from any non-error response that is shared-cacheable by then
  — including a returned web `Response` — so the order of limiter, logger and
  profile no longer matters. `none`, `private` profiles and error responses are
  untouched; a 429 keeps its `Retry-After`.

  The README's Workers Cache section now documents the full enablement contract
  (narduk-libs#435): the verified `"cache": { "enabled": true }` mechanism, that
  a response with no `Cache-Control` is still stored (a 200 for 2 hours), the
  narduk-core >= 2.2.4 precondition, and how to prove a HIT.

### Patch Changes

- Updated dependencies [a82dc2d]
  - @narduk-enterprises/narduk-logging@0.3.0

## 2.2.4

### Patch Changes

- fe58c5f: SSR HTML is never shared-cache storable on an app that serves the
  nonce CSP (`nardukCore.security.headers` in `enforce` or `report-only` mode),
  because nuxt-security writes one per-request nonce into both the HTML and the
  CSP header and an edge cache would replay it to every visitor
  (narduk-libs#435). `setCacheProfile` refuses a cacheable profile on a page
  render with the new `nonce-csp-html` suppression reason, and a new
  `nonce-csp-cache` Nitro plugin pins `Cache-Control: private, no-store` on the
  final `text/html` response and strips `CDN-Cache-Control`,
  `Cloudflare-CDN-Cache-Control`, `Surrogate-Control`, `Cache-Tag`, `Expires`
  and `Age` however they got there. JSON API routes and Nuxt `_payload.json`
  responses keep their profile and stay edge-cacheable. In development, a page
  that asked for a cacheable profile logs one warning per path.

  `@narduk-enterprises/create-narduk-app` only re-releases so its pinned
  `@narduk-enterprises/narduk-core` version follows this patch
  (`scripts/check-generator-release-plan.mjs`'s generator-pin rule) — no
  generator behavior changes.

## 2.2.3

### Patch Changes

- 7ae9278: Thrown 4xx/5xx responses — including a 429 from
  `defineRateLimitedHandler` — now carry `Cache-Control: private, no-store` and
  drop `CDN-Cache-Control`, `Cloudflare-CDN-Cache-Control`, `Surrogate-Control`,
  `Cache-Tag`, `Expires` and `Age`, even when the route had already set a
  cacheable profile (e.g. `setCacheProfile(event, 'live')`) before throwing.
  Nitro's own error page otherwise ships `Cache-Control: no-cache`, which
  Cloudflare Workers Cache _stores_ and revalidates once an app turns on
  `"cache": { "enabled": true }`; `no-store` / `private` are the documented
  opt-out. This is a safe precondition for narduk-libs#435 (making
  `setCacheProfile`'s edge header actually hit) — do not enable Workers Cache in
  a consuming app until this release.

  The header-strip list that already backed the `preferences-cache` plugin
  (narduk-libs#386) moved to a new framework-free
  `runtime/shared/utils/shared-cache.ts` so the error path reuses it rather than
  duplicating it; `preferences.ts` re-exports the same names it always has, so
  no consumer import changes.

  `@narduk-enterprises/create-narduk-app` only re-releases so its pinned
  `@narduk-enterprises/narduk-core` version follows this patch
  (`scripts/check-generator-release-plan.mjs`'s generator-pin rule) — no
  generator behavior changes.

## 2.2.2

### Patch Changes

- 766ce96: Fix the estate CSP baseline refusing GA4's Google-signals beacon
  (narduk-libs#472). A GA4 property with Google signals enabled sends a second
  `page_view` beacon straight to `https://www.google.com/g/collect` (not a
  `*.google-analytics.com` host), with an `<img>` fallback at the same origin
  when `fetch`/`sendBeacon` is unavailable. Both the strict nonce-CSP baseline
  (`runtime/shared/security-headers.ts` `BASELINE_ALLOWLIST`) and the legacy
  enforcing middleware (`runtime/server/middleware/securityHeaders.ts`
  `BASELINE_CONNECT_SRC`) now allow `https://www.google.com` on `connect-src`;
  the legacy middleware's `img-src` already carries an `https:` wildcard that
  covers the same host, so it needed no change. A property that runs with Google
  signals off never sends this beacon and does not need the host.

  create-narduk-app re-releases so its generated package pins follow the
  narduk-core patch and its dependents.

## 2.2.1

### Patch Changes

- fa41027: Default `colorMode.classSuffix` to `''` so `@nuxtjs/color-mode`
  writes `class="dark"` instead of `class="dark-mode"`. Tailwind v4 and Nuxt UI
  4 key dark styles on `.dark`, so the previous suffix left every dark token
  inert.

  **Adoption.** Apps with no dark styling will start rendering Nuxt UI chrome
  dark for dark-preference users. An app that wants light-only sets
  `colorMode: { preference: 'light', fallback: 'light' }` (Buoys does). An app
  can still override `classSuffix`.

- fa41027: Omit `upgrade-insecure-requests` from the `security.headers`
  report-only CSP. Browsers ignore that directive in a report-only policy and
  Chromium logs a console error on every page. The enforcing header still
  includes it.

## 2.2.0

### Minor Changes

- cfa085f: Add `createNardukDataClient` and `fetchNardukDataJson` — a shared
  server-side client for published narduk-data products, so an app that reads
  `data.nard.uk` stops re-deriving the manifest/artifact/checksum dance and the
  resilience policy around it.

  **The gap.** Buoys' `apps/web/server/utils/buoy-status-product.ts` hardcodes
  `https://data.nard.uk`, fetches `current/manifest.json`, fetches the release
  artifact, reads it under a byte ceiling, compares its SHA-256 against the
  manifest, memoises the result for 60 seconds and coalesces concurrent misses —
  about 120 lines before a single buoy-specific line. RiverStatus'
  `apps/web/server/utils/narduk-river-data.ts` does the same walk again for
  `river-status-v1`, with a different manifest validator, no timeout, no retry,
  no memo and no coalescing. Neither has a retry, a stale-if-error fallback, or
  freshness metadata a caller can act on, and the next consumer would have
  written a third copy.

  **The client.**

  ```ts
  import { createNardukDataClient } from '@narduk-enterprises/narduk-core/server/utils/narduk-data'

  const client = createNardukDataClient({ userAgent: 'BuoyStat.us/1.17' })

  const { data, freshness, manifest } = await client.read(
    {
      artifactPath: 'public-buoy-data.json',
      maxStaleMs: 10 * 60_000,
      productId: 'buoy-status-v1',
      schema: productSchema,
    },
    { requestId: event.context._requestId },
  )
  ```

  `read` fetches the manifest, fetches the artifact **the manifest names** under
  `releases/<releaseId>/`, refuses it unless its SHA-256 matches, and validates
  both against caller-supplied schemas; `artifactPath` is an optional assertion
  that refuses a manifest naming anything else. Optional `acceptManifest` and
  `validate` hooks let a consumer refuse a release before the artifact is
  downloaded and before the pair is cached, so a bad release is never memoised.
  Each attempt carries its own `AbortSignal.timeout`; the bounded retry applies
  only to an idempotent `GET`/`HEAD` and only on a network failure, a timeout or
  an HTTP 5xx, so a 4xx, a schema failure and a checksum mismatch are never
  repeated and a non-GET is attempted exactly once. Concurrent readers of the
  same product join the read already in flight, keyed on every ceiling,
  validator and hook that decides whether a value is valid — so a stricter
  caller is never answered from a permissive one's entry — and a caller's own
  `signal` cancels only its own wait, never the shared read. `maxStaleMs` opts
  into serving the last good value after an upstream failure; it defaults to 0,
  so the client fails closed exactly as today's hand-rolled reads do, and a
  `failureCooldownMs` (default 10 s) keeps an outage from making every request
  re-pay the retry budget.

  **Freshness that stays honest.** Every result carries `fetchedAt`, `ageMs`,
  `source` (`upstream` | `memo` | `stale-if-error`), `releaseId`, `observedAt`
  and `observedAgeMs` (the newest observation in the release), `evaluatedAt`
  (when the producer cut it — a different instant, kept apart), the producer's
  own `publishedState` republished verbatim, and a `state` of `fresh` | `aging`
  | `stale` | `unknown`. Thresholds come from the product, or from the
  manifest's own `fresh_if_less_than_minutes` / `warning_if_at_most_minutes`
  when it declares none, so an app need not hardcode a duplicate that can drift;
  with neither, the state is `unknown` — never `fresh`. `source` and `state` are
  the only two staleness signals and they answer different questions. A value
  served from the stale path says so rather than arriving as if it were current,
  and an artifact that is validly empty stays distinguishable from a missing or
  stale one.

  **Errors, not silence.** Every failure is a `NardukDataError` carrying
  `reason` (`aborted` | `checksum` | `http` | `network` | `rejected` | `schema`
  | `timeout` | `too-large`), `status` and `url`, so a caller can tell an outage
  from a contract break from a consumer refusal from its own cancellation. A
  caller that cancelled is always told it cancelled, never handed stale data in
  place of the answer it withdrew.

  **Worker-safe by construction.** No Node-only API, no module-level cache — the
  caller owns the client instance and its cache is bounded by both `maxEntries`
  (default 8) and `maxCacheBytes` (default 32 MiB) of retained artifact bytes,
  least recently used evicted, with `clear()` to drop it — hard body ceilings
  enforced against bytes actually accumulated rather than a `content-length` the
  upstream declares (`manifestMaxBytes`, default 256 KiB, is separate from the
  artifact's `maxBytes`), and no timer of its own: cancellation rides on
  `AbortSignal`.

  **Credential hygiene.** `accept`, `user-agent` and `x-request-id` are managed
  and cannot be overridden by a caller; `authorization`, `cookie` and
  `proxy-authorization` are dropped rather than forwarded to the data origin;
  every URL is pinned to the configured origin and a redirect is an error rather
  than a hop off it.

  **Request-id ready.** `context.requestId` is sent as `x-request-id` and
  `context.headers` is merged in, so the request-id middleware plugs in without
  this module minting ids. Single-flight means the callers joined onto a read
  are answered by a request carrying the first caller's id; the README says so.

  **Placement.** `narduk-core` rather than a new package: it is already every
  app's dependency, the consumers are Nitro server routes that install this
  layer anyway, the freshness vocabulary it echoes lives here, and a new
  published package would be a second release surface for one module. Additive
  only — existing exports are untouched, and an app that never imports it gets
  an identical build.

  **Compatibility.** `schema` and `manifestSchema` accept any validator with a
  zod-shaped `safeParse`, so zod v4 schemas plug in structurally and this
  package takes on no validator dependency or version pin of its own.

- 3ae6e51: Add the reader preference store and its formatters:
  `usePreferences()`, `useFormatters()`, and the pure functions underneath them.
  An app stores measurements in SI and displays them in whatever the reader
  asked for, one call site at a time — nothing here rewrites existing display
  code and nothing is global.

  **One cookie, `ne_prefs`**, carries units, time zone and locale as a small
  versioned parameter string (`v=1&u=imperial&tz=America%2FChicago&l=en-US`). It
  is read during SSR, so there is no client-only flash of the wrong unit, and it
  is validated on read: a future schema version, a truncated or hand-edited
  value, an unknown time zone, or something that is not a parameter string at
  all decodes to no selection and the documented defaults apply. A bad cookie is
  never a 500, and a cookie with one bad field keeps its good ones. Unset,
  `locale` comes from `Accept-Language` (`en-US` when absent), `units` is
  imperial for a `US` region and metric otherwise, and `timeZone` is `UTC`.

  **Hydration is the contract, not a hope.** Server and client read the same two
  inputs — the cookie, and defaults the server resolved once and carried in the
  Nuxt payload — so the first client render reproduces the server's markup
  exactly. The browser's time zone is the one input the server cannot have, so
  it is adopted _after_ mount rather than guessed during render. The proof
  renders with `renderToString`, hydrates that markup with a real
  `createSSRApp().mount()`, and fails on a Vue hydration warning; its control
  case reproduces the naive implementation and requires the warning to appear.

  **Cache safety.** Reading preferences during SSR marks the response, and a
  marked response is forced to `private, no-store` with
  `Vary: Cookie, Accept-Language`. Shared-cache headers (`CDN-Cache-Control`,
  `Cloudflare-CDN-Cache-Control`, `Surrogate-Control`, `Cache-Tag`) are removed
  so Cloudflare cannot ignore `Cache-Control`. Marking strips headers already
  written; `setCacheProfile` (new `preferences-cookie` suppression reason) and
  the `preferences-cache` plugin (`render:response` and `beforeResponse`)
  re-check the flag so call order cannot leak a shared profile. Nitro
  `routeRules` `swr`/`cache`/`isr` is incompatible with preference-shaped pages
  and is documented as such. Nothing downgrades a response that never read
  preferences, so existing app cache profiles are unchanged.

  **The formatters** are standalone pure functions over SI inputs, so importing
  one does not ship the rest: `formatDistance`, `formatSpeed`,
  `formatTemperature`, `formatHeight`, `formatLength`, `formatPressure`,
  `formatDecimal`, and the timezone-aware `formatZonedDate` / `formatZonedTime`
  / `formatZonedDateTime`. `null`, `undefined`, `NaN`, `Infinity` and an
  unparseable date all render an em dash rather than `NaN ft`. `timeZone` and
  `locale` are arguments with fixed fallbacks, never the host's. No new
  dependency: `Intl` does the work, including every daylight-saving transition
  date.

- 77945b9: Add `defineValidatedHandler`: a per-route zod contract for Nitro
  handlers, alongside the existing `defineRateLimitedHandler`. A route declares
  `query`, `params`, `body` and `response` schemas and receives them parsed and
  fully typed — it never touches `getQuery`, `getRouterParam` or `readBody`.

  A bad request answers **400** with `data.code = 'VALIDATION_FAILED'` and a
  flat list of `{ path, message }` rooted at the part it came from
  (`query.limit`, `params.stationId`, `body.items[0].name`). **A submitted value
  never appears in that body**, in a message or in a path, so a rejected
  password or token cannot travel back out through the error. Object keys do
  appear, as path segments — which for a `z.record` is caller data — and the
  guarantee covers zod's built-in messages, not a schema's own `error` callback.
  Params and query are checked together so one response names every bad field;
  the body is only read once they pass. A body over `maxBodyBytes` (1 MiB by
  default) answers **413** before it is parsed, and a body that is not JSON —
  including one sent with no `content-type` at all, which is the cross-origin
  simple request a declared JSON type would have forced a preflight for —
  answers **415**; both carry a `data.code`.

  `response` is an assertion, not a transformer: the value the client receives
  is exactly what the handler returned, whether or not the check ran, so a route
  cannot behave differently in production because validation was skipped. A
  broken response contract logs one structured error through
  `@narduk-enterprises/narduk-logging` and answers **500** — naming the
  offending paths in development and test, opaque in production. Checking is
  **on in development and test, off in production by default**: every request on
  Workers pays for it in metered CPU on data the server itself produced, and a
  response-shape mismatch is a code defect. Opt in with `validateResponse: true`
  or sample with `validateResponse: 0.01`.

  Composition order with `defineRateLimitedHandler` is an explicit contract:
  **rate limit outside, validate inside**, so a throttled caller is rejected
  before the body is read or a schema runs. There is deliberately no `rateLimit`
  option on this wrapper.

  No new dependency: zod 4 is already a direct dependency of this package.

- 31a43a7: Correct published packaging declarations so they match what these
  packages already require at install time. This is not a runtime change.

  Nine Nuxt modules already depend on `@nuxt/kit` `^4.0.0`, which does not run
  on Nuxt 3, but advertised `peerDependencies.nuxt` as `>=3.16.0`. The peer is
  now `>=4.0.0`, matching narduk-shell and narduk-mapkit-nuxt. `narduk-core` and
  `narduk-realtime` also raise `@nuxt/schema` to `>=4.0.0` so it matches `nuxt`.
  `narduk-core` and `narduk-analytics` add exact `./app/types/*` entries for the
  `.ts` files that the `*.d.ts` export pattern could not resolve. The analytics
  key exports runtime `const`s, so it carries `types` then `import` then
  `default`. Core `./app/types/api` stays types-only because that file is
  interfaces. `narduk-app` declares `zod` `^4.4.3` as an optional peer (kept in
  `devDependencies`) so consumers that typecheck `./server/request-body` can
  resolve `z.ZodType` without warning HTTP-only consumers. `narduk-shell`
  tightens `vue-router` to `^5.3.1` so the published package matches `@nuxt/ui`
  `4.8.1` and the workspace override.

  ## Operator action

  The Nuxt 4 peer (`nuxt` and, where declared, `@nuxt/schema`) is a
  consumer-visible floor raise, so the nine modules that advertised Nuxt 3 ship
  as `minor`. Every narduk-app in the estate is already on Nuxt 4; Buoys is on
  4.5.2. A remaining Nuxt 3 app cannot take this release — and already could not
  run these modules, because they depend on `@nuxt/kit` `^4.0.0`.
  `create-narduk-app` is a companion patch so generator pins move with the
  minors. `narduk-app` (optional zod peer) and `narduk-shell` (vue-router
  already at UI 4.8.1) stay `patch`.

### Patch Changes

- f08deca: Make the sealed `nuxt-session` cookie a pointer to `auth_sessions`,
  not the grant itself.

  `requireAuth` now consults an optional session-grant validator that
  narduk-auth registers on the request. Core-only apps (no validator) keep
  cookie-as-grant behavior. Apps that install narduk-auth fail closed: a cookie
  whose `auth_sessions` row is missing, expired (local), or never existed no
  longer authenticates.

  **Operational consequence.** After deploy, existing sealed cookies whose
  `auth_sessions` row is absent will stop authenticating. That may log some
  users out once — including local-email sessions minted before this change,
  which never wrote a row. They sign in again and receive a server-side session.
  Logout and password change now revoke other browsers that still hold a copy of
  the cookie.

  Login (not the per-request refresh path) opportunistically deletes a
  `LIMIT`-bounded batch of expired `auth_sessions` rows via the existing
  `expires_at` index. Supabase rows now carry the same 30-day absolute expiry as
  local sessions so abandoned rows are sweepable.

  This is a patch: exported function signatures are unchanged, and the behavior
  change is a security correction, not a new API.

- d148560: Restrict the canonical-host redirect to top-level document
  navigations, and retire the duplicate canonical-redirect middleware.

  `00-canonical-host` redirected every `GET`/`HEAD` with a `308`, including
  `/api/**` and `/_nuxt/**`. On any non-canonical hostname — a `workers.dev`
  preview, a per-version preview URL, a branch alias — that turned every
  same-origin `fetch()` into a cross-origin redirect the browser refuses for
  want of an `Access-Control-Allow-Origin` header, while the canonical host
  still ran the handler and paid its cost (a wasted Apple MapKit token mint and
  rate-limit slot in the case that found it). The redirect now fires when
  `Sec-Fetch-Dest` is `document`, is skipped when it is anything else, and, for
  a request carrying no fetch metadata at all, keeps canonicalising page paths
  for crawlers while never redirecting `/api/**` or `/_**`. Auth routes reached
  by navigation — `/auth/callback`, `/auth/confirm`, a provider redirect into
  `GET /api/auth/session/exchange` — still canonicalise before setting a cookie.

  `runtime/server/middleware/canonicalRedirect.ts`, a second auto-registered
  canonical-host middleware that redirected with `301` and gated on
  `import.meta.dev`, no longer sits in the scanned middleware tree. The import
  path `@narduk-enterprises/narduk-core/server/middleware/canonicalRedirect`
  still resolves, as a deprecated alias exporting the one live handler, so apps
  that run the core middleware chain by hand keep compiling.

- 384925d: Exempt the configured CSP report route from CSRF so browser
  `report-uri` POSTs can reach the sink.

  `security.headers` registers `POST` at `reportRoute` (default
  `/api/_security/csp-report`) and emits that path as `report-uri`. Browsers
  send `application/csp-report` with no `X-Requested-With`, so the estate CSRF
  middleware was returning 403 and a report-only soak looked empty. The skip now
  reads `runtimeConfig.nardukSecurityHeaders.reportRoute` — the same value the
  module writes when it registers the handler — rather than a hardcoded path.
  The skip applies only when `nardukSecurityHeaders.mode` is `report-only` or
  `enforce`, so the default `off` mode does not CSRF-exempt a 404.

- 384925d: Sanitize production 5xx payloads before Nuxt serializes them into
  `__NUXT_DATA__`, and reject oversized CSP report bodies with 413.

  Nitro's prod handler only redacts `message`/`data` when `unhandled` or `fatal`
  is set. Vue SSR wraps the throw as a handled H3Error, so the raw message still
  reached the client. A prepended Nitro error handler now genericizes 5xx when
  `previewSafeMode` is off, without replacing Nuxt's renderer. `nuxt dev` skips
  the sanitizer (`import.meta.dev`) so local 5xx still show the original
  payload. A string `statusCode` such as `"404"` is coerced before the 5xx
  decision, so 4xx `data` still reaches clients; a string that does not name a
  real HTTP status (`"-1"`, `"0"`, `"404abc"`) falls back to 500 and is
  sanitized. The CSRF-exempt CSP report sink now refuses bodies over 64 KiB
  before parse.

- 384925d: Fix `isPrivateIPv6` so IPv4-mapped, IPv4-compatible, and NAT64
  addresses decode their embedded IPv4 instead of string-matching `::ffff:`.

  This closes the loopback and unspecified bypass (`::127.0.0.1` / `::7f00:1`,
  `::`, `64:ff9b::127.0.0.1`) and also **fixes a false-positive** that blocked
  legitimate IPv4-mapped public hosts such as `::ffff:93.184.216.34`
  (`::ffff:5db8:d822`). Consumers that previously saw those public mapped
  addresses rejected as private will now see them allowed.

- Updated dependencies [384925d]
- Updated dependencies [e8e6892]
  - @narduk-enterprises/narduk-logging@0.2.0

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
