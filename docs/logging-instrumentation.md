# Logging instrumentation across narduk-libs

Audit date: 2026-10-05. Scope: every runtime module under `packages/modules/`
except narduk-logging itself. Asked for by Logan on 2026-10-05: _"if there are
things in narduk-libs to instrument....we should probably instrument those in
there if not already instrumented"_.

Apps' production Workers export console output to Loki (`logs.nard.uk`) through
Cloudflare OTLP. So any record a module writes through the logger reaches Loki,
with the request ID, route template and deployed build version attached.

## The pattern

A module writes records the way narduk-core already does. It never configures
logging itself and never adds network activity.

1. **Request code (Nitro routes and server utils that receive an `H3Event`).**
   Use narduk-core's bridge: `useLogger(event).child('<Scope>')`. A Nuxt layer
   imports it from `#layer/server/utils/logger`; a module that depends on core
   imports it from `@narduk-enterprises/narduk-core/server/utils/logger`. The
   bridge is request-scoped and memoized. It applies the app's `LOG_LEVEL` and
   `nardukLogging` runtime config, and it stamps `requestId`, `method`, the
   route template and `buildVersion`. Do not import narduk-logging directly for
   this. The bridge is the integration point, and going through it keeps the
   dependency graph unchanged.
2. **Event-less library code (clients, pure helpers, Worker or Node
   libraries).** Accept an optional injected logger. Its type is a narrow
   structural interface (`info`/`warn`/`error` taking
   `(message, data?: Record<string, unknown>)`), which narduk-core's bridge
   logger and a narduk-logging `Logger` both satisfy. With no logger the code
   writes nothing, so the change is additive and source-compatible. The caller
   passes `useLogger(event).child('<Scope>')`. narduk-ai's `AiCallLogger` is the
   reference. narduk-mapkit's older `MapKitTokenResponseOptions.log` is a single
   `(entry) => void` callback, which works but should not be copied.
3. **Safe fields.** A record carries stable codes (`reason`, `code`, `kind`),
   counts, sizes, durations, status codes, internal IDs and normalized types. It
   never carries:
   - secrets, tokens, keys or cookies
   - email addresses, client IPs or client-chosen file names
   - full URLs with query strings (log a host or a route template instead)
   - request or response bodies, prompts or model output
   - third-party error text that can echo any of these

   narduk-logging redacts sensitive key names (`password`, `token`, `email`,
   `prompt`, `body`, …), but redaction protects you only when a value sits under
   a sensitive key. Do not log the value in the first place.

4. **Errors.** Pass the error itself as `error` (`log.error('…', { error })`).
   The logger lifts it to the record's `error` field, strips control characters,
   and drops the stack in production. Its `message` is **not** scrubbed for
   credentials (see Findings below). Before logging an error whose message can
   carry a secret, map it to a fixed `reason` instead.
5. **Levels.**
   - `error`: a dependency failed (storage, provider, database).
   - `warn`: a refusal worth investigating (lockout, verification failure, 4xx
     rejection reason).
   - `info`: a normal but auditable event (a failed sign-in attempt, a completed
     provider call).
   - `debug`: success detail.

   The production default for the core bridge is `warn`, so `info` records
   appear only where the app sets `LOG_LEVEL=info`.

6. **Client bundles.** Only server files change. Nothing under `app/`, no
   composable and no client plugin imports the logger, so client bundles do not
   grow.
7. **Tests.** Each instrumented module asserts its records through narduk-core's
   **real** bridge with a capturing sink. The setup is a `nitropack/runtime`
   alias to a stub, `vi.mock('nitropack/runtime')` supplying
   `nardukLogging.sinks`, and a real `h3` event. Each module also has one
   redaction case proving the unsafe value never reaches a serialized record.

## Audit

Status: **done** means instrumented by this lane; **existing** means it was
already instrumented before this lane; **gap** means not yet instrumented.

### narduk-auth: [#1471](https://github.com/narduk-enterprises/narduk-libs/pull/1471)

Already broadly instrumented through `#layer/server/utils/logger`: about 40 call
sites in 16 files cover passkeys, account linking, session refresh, API keys,
auth email, account deletion and MCP OAuth.

| Boundary                                                           | Level      | Fields                            | Status                                                                                                                       |
| ------------------------------------------------------------------ | ---------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Local email/password attempt failed                                | info       | `kind`, `failures`                | done                                                                                                                         |
| Local lockout started                                              | warn       | `kind`, `failures`, `lockSeconds` | done                                                                                                                         |
| Request refused while locked out (429)                             | warn       | `kind`, `retryAfterSeconds`       | done                                                                                                                         |
| Apple web callback refused / cancelled                             | warn/info  | `code`                            | done                                                                                                                         |
| Apple identity token refused                                       | warn       | `reason` (fixed code)             | done                                                                                                                         |
| Passkey registration/sign-in failures, counter regression          | warn/error | `userId`, `deviceType`            | existing                                                                                                                     |
| Session lookup/refresh failure, terminal refresh                   | warn       | `error`                           | existing                                                                                                                     |
| Auth email provider rejected/failed                                | error      | status                            | existing                                                                                                                     |
| Supabase session exchange failed (`auth-flows.ts` Apple, callback) | warn       | `flow`, provider `status`         | gap: needs a failing-exchange fixture in `closed-signup-and-recovery-link.test.ts`                                           |
| Native authorize / MCP consent 401/403 refusals                    | warn       | route code                        | gap: small; MCP OAuth already logs through its injected `logger`                                                             |
| `AUTH_REQUIRE_MFA` ignored on local backend (startup plugin)       | warn       | none                              | gap: still `console.warn` at Nitro plugin init. There is no request, and core has no non-request logger yet; see Follow-ups. |

### narduk-uploads: [#1467](https://github.com/narduk-enterprises/narduk-libs/pull/1467)

| Boundary                                        | Level           | Fields                                                             | Status                                                   |
| ----------------------------------------------- | --------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| Upload refused (411/413/400/415)                | warn            | `statusCode`, `reason`, `contentLength`/`declaredType`/`fileCount` | done                                                     |
| R2 write failed                                 | error           | `key`, `contentType`, `sizeBytes`, `storedCount`, `error`          | done                                                     |
| R2 read failed (`GET /images/**`)               | error           | `slug`, `error`                                                    | done                                                     |
| Uploaded image over performance budget          | warn            | `key`, `sizeBytes`, `performanceWarnings`                          | existing; the client `filename` was removed by this lane |
| Upload succeeded / image blocked / image served | info/warn/debug | `count`, `keys`, `slug`, `contentType`                             | existing                                                 |

### narduk-ai: [#1463](https://github.com/narduk-enterprises/narduk-libs/pull/1463)

| Boundary                                                            | Level    | Fields                                                                                                        | Status                                         |
| ------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Provider call completed (`chatCompletion`, `grokChat`, list models) | info     | `provider` (host), `operation`, `model`, `responseModel`, `statusCode`, `durationMs`, `attempts`, token usage | done (injected `logger`)                       |
| Stream opened (`grokChatStream`)                                    | info     | as above, timed to headers                                                                                    | done                                           |
| Retry after 5xx / network / timeout                                 | warn     | `attempt`, `reason`, `statusCode`                                                                             | done                                           |
| Final failure                                                       | error    | `reason` (`http_status`/`timeout`/`network`/`invalid_response`), `statusCode`, `durationMs`, `attempts`       | done                                           |
| Caller abort                                                        | warn     | `reason: aborted`                                                                                             | done                                           |
| Admin model listing (`resolveStoredChatModel`)                      | as above | as above                                                                                                      | done (passes core's request logger)            |
| Malformed SSE record skipped mid-stream                             | debug    | none                                                                                                          | gap: low value; the stream continues by design |

### narduk-analytics

Uses `@narduk-enterprises/narduk-core/server/utils/logger` in 9 files (GA, GSC,
IndexNow, PostHog success paths). No `console.*` calls.

| Boundary                                                                                                                                                                                        | Level | Fields                          | Status                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------- | ------------------------------------------------------------------------ |
| PostHog admin handlers rethrow without a record (`posthog/recordings.get.ts:104`, `pages.get.ts:85`, `entry-exit.get.ts:103`, `referrers.get.ts:81`, `insights.get.ts:77`, `devices.get.ts:80`) | error | endpoint, upstream `statusCode` | gap                                                                      |
| GSC `inspect-url.post.ts:62`, `sitemaps.get.ts:61` rethrow silently; `submit-sitemap.post.ts:48` has no catch                                                                                   | error | endpoint, `statusCode`          | gap                                                                      |
| IndexNow non-2xx recorded only inside an info record (`api/indexnow/submit.post.ts:94`)                                                                                                         | warn  | engine host, `statusCode`       | gap                                                                      |
| Google OAuth token fetch failure (`utils/google.ts:91`), PostHog `$fetch` (`utils/posthog.ts:129,144`)                                                                                          | error | host, `statusCode`              | gap. Log at the call sites above, not in the helper, which has no event. |
| Existing records log `error.message` directly, not `{ error }`                                                                                                                                  | n/a   | n/a                             | gap: migrate to the `error` field                                        |

### narduk-seo

Uses the core bridge in `server/handlers/securityTxt.get.ts` and
`server/utils/adminOgImageRoutePreview.ts`. Its build-time module logs use Nuxt
kit's `useLogger` (correct for build time).

| Boundary                                                                                                                      | Level | Fields                    | Status                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------- | ----------------------------------------------------------------------------------------- |
| Narduk network directory fetch failure/timeout swallowed (`server/api/narduk-network/sites.get.ts:40,66`)                     | warn  | host, `statusCode`/reason | gap                                                                                       |
| `console.warn` in `app/utils/safeCanonicalUrl.ts:62` (dev only) and `app/plugins/defaultSocialImage.ts:52` (universal plugin) | n/a   | n/a                       | out of scope: client/universal code; must not pull a server logger into the client bundle |

### narduk-realtime

A Worker and Durable Object library, not a Nuxt layer, with no narduk-core
dependency. It has no logger and no injection point.

| Boundary                                                                                                   | Level     | Fields                | Status |
| ---------------------------------------------------------------------------------------------------------- | --------- | --------------------- | ------ |
| Upgrade router misconfiguration 500s (`src/worker/upgrade-router.ts:412` `routerFailure`, 489/496/526/535) | error     | fixed failure code    | gap    |
| Origin refusals (403) (`upgrade-router.ts:404`)                                                            | warn      | route, refusal code   | gap    |
| `route.authorize` and DO `stub.fetch` without a catch (`upgrade-router.ts:509,554`)                        | error     | route, `error`        | gap    |
| WebSocket accept/close/error (`src/server/durable-object.ts:94,121`; no `webSocketError` override)         | info/warn | close code, tag count | gap    |

Proposed change: add an optional `log` option shaped like narduk-ai's
`AiCallLogger` to `UpgradeRouterOptions` (`upgrade-router.ts:184`) and to the
Durable Object base, following pattern 2. narduk-realtime commits its `dist/`,
so the change also needs `pnpm --filter … run build`.

### narduk-postgres and narduk-timeseries

Node and Worker libraries with no H3. Neither has a logger or `onError` option.

| Boundary                                                                                                       | Level     | Fields             | Status                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | --------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Connection open failure wrapped as `NardukPostgresError` (`worker.ts:92`, `node.ts:78`, `supabase.ts:204`)     | error     | driver code        | gap                                                                                                                          |
| `connection.end()` failure dropped when the body also threw (`worker.ts:110`, `node.ts:96`, `supabase.ts:221`) | warn      | driver code        | gap                                                                                                                          |
| ROLLBACK failure swallowed (`migrate.ts:562`); advisory-unlock error dropped (`migrate.ts:646,667`)            | warn      | migration id       | gap                                                                                                                          |
| DB round-trip counting via `QueryCounter`                                                                      | n/a       | n/a                | gap. Apps can call `useRequestCounter(event).recordRoundTrip()` in their own executor; narduk-core's D1 helper already does. |
| timeseries retention sweep: unlock error dropped (`timescale/index.ts:500,528`), coalesced sweep silent        | warn/info | table, `coalesced` | gap                                                                                                                          |

Proposed change: an optional `log` on `ApplyMigrationsOptions`,
`ConnectionTuningOptions` and `RetentionExecutorOptions` (pattern 2).

### narduk-tenancy and narduk-devices

Nuxt modules that depend on narduk-core only as a devDependency. Their services
take options objects (`TenancyServiceOptions`, `DevicesServiceOptions`).

| Boundary                                                                                                       | Level | Fields             | Status                                                   |
| -------------------------------------------------------------------------------------------------------------- | ----- | ------------------ | -------------------------------------------------------- |
| Tenancy non-unique-constraint DB error rethrown (`tenancy.ts:867`), `withTenancyErrors` (`tenancy-http.ts:94`) | error | operation, `error` | gap                                                      |
| Devices opportunistic prune error deliberately swallowed (`devices.ts:1053`)                                   | warn  | `error`            | gap: this is the one silent background job in the estate |
| Device signature verify exception returns `false` (`devices-signing.ts:145`)                                   | debug | algorithm          | gap: low value                                           |

Proposed change: an optional `log` on the service options (pattern 2). Adding a
runtime narduk-core dependency would widen their install footprint.

### narduk-mapkit and narduk-mapkit-nuxt

| Boundary                                                                                                                                                                                        | Level | Fields                                             | Status                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Token route failure only reported through optional `options.log`, which **neither Nuxt route passes** (`src/nuxt/runtime/server/mapkit-token.get.ts:131`; mapkit-nuxt `mapkit-token.get.ts:71`) | error | `status`, `refusal`, `deprecatedKeys` (value-free) | gap: highest-value remaining item. Both routes have the event and can pass `log`. The entry has no error field, so add a fixed reason. |
| Doppler/config resolution failure → constant 500 (`server/node.ts:62`, `server/config.ts:139`)                                                                                                  | error | reason                                             | gap                                                                                                                                    |
| `console.warn` for retired runtimeConfig keys at module setup (`src/nuxt/index.ts:109,116`)                                                                                                     | n/a   | n/a                                                | out of scope: build-time Nuxt module, where console output is correct                                                                  |
| `console.warn` in `useMapkitToken.ts:12` (universal composable)                                                                                                                                 | n/a   | n/a                                                | out of scope: client bundle                                                                                                            |

narduk-mapkit commits `dist/`, so a change needs a build.

### narduk-app and geogrid-web

- **narduk-app**: small H3 helpers with no outbound I/O, DB access or jobs.
  Nothing worth a record.
- **geogrid-web**: browser-only; WebGL setup failures surface through the host's
  `onError` by design. Out of scope for server logging.

## Findings

- **Error messages are not scrubbed.** narduk-logging's `sanitizeErrorForLog`
  strips control characters from an error's `message` but does not redact
  credentials inside it. For example, `new Error('… Authorization: Bearer x')`
  reaches the record verbatim (observed in the narduk-uploads tests). Library
  code here should log fixed reasons for errors that can carry secrets. Whether
  narduk-logging should pattern-scrub messages is a narduk-logging design
  question and was not changed by this lane.

## Follow-ups (in value order)

1. mapkit / mapkit-nuxt: pass `log` from both token routes, with a fixed reason
   on the error path.
2. analytics: record the silent PostHog/GSC/Google failure paths, and move the
   existing `error.message` fields to `{ error }`.
3. realtime: an injected `log` on `UpgradeRouterOptions` and the Durable Object
   base.
4. devices: record the swallowed opportunistic-prune failure.
5. postgres / timeseries: an injected `log` for dropped cleanup errors.
6. auth: Supabase exchange failures. For the startup MFA advisory, either add a
   non-request logger export to narduk-core (for example `useServerLogger()`,
   built from `resolveLoggingOptions()` with no event) or leave it as
   `console.warn`.
7. seo: the network-directory fetch failure.
