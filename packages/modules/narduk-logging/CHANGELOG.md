# Changelog

## 0.3.1

### Patch Changes

- 7bfcf46: Fix `logRequest` throwing a `RangeError` on a 101 WebSocket upgrade
  response.

  `logRequest` re-wrapped every handler response with
  `new Response(response.body, response)` to attach correlation headers.
  `new Response(body, init)` only accepts a status in 200–599, so a handler
  returning a 101 Switching Protocols response (the normal shape for a Durable
  Object WebSocket endpoint, as `@narduk-enterprises/narduk-realtime` uses) made
  `logRequest` throw before the upgrade ever reached the client. The re-wrap
  would also have dropped `webSocket`, the Cloudflare Workers upgrade extension
  carrying the actual socket pair — the whole payload of an upgrade in workerd.

  `logRequest` now returns a 101 (or any response carrying `webSocket`)
  untouched, skipping the correlation-header and Server-Timing stamp it would
  otherwise add — a protocol switch has no body to stream and nothing useful to
  attach one to.

## 0.3.0

### Minor Changes

- a82dc2d: Add the statement / round-trip counter contract from narduk-libs#325.
  `QueryCounter` is driver-agnostic: a data-binding wrapper calls
  `recordRoundTrip(statements = 1)` once per call into the binding
  (`statements.length` for a D1 batch). Every `RequestTiming` owns one as
  `timing.counter`; on h3, `useRequestCounter(event)` returns the same object.
  Once anything is counted, exposed phases render their own delta
  (`desc="1 stmt / 1 rt"`) and `total` renders the cumulative counts, and the
  "Request completed" / "Slow route" records carry `statements` and
  `roundTrips`. A request that counts nothing renders and logs exactly what it
  did before. Also exported: `formatQueryCounts` and the `QueryCounts` type.

## 0.2.0

### Minor Changes

- e8e6892: Add end-to-end request-ID propagation and per-request Server-Timing
  to `narduk-logging`'s `h3` and `worker` adapters.

  `requestId` now accepts a `cf-ray` fallback seed, so a request that never sent
  its own correlation ID still lines up with Cloudflare's own edge trace instead
  of getting a disconnected UUID. `requestIdHeaders(id)` returns the header bag
  to forward that ID on an outbound call (for example to a `narduk-data` fetch),
  and `REQUEST_ID_HEADER` names the header once so no consumer has to repeat the
  string or reach into `event.context._requestId`. The inbound header is
  validated against a bounded charset, never trusted: any client can choose the
  ID its own request arrives with, so it correlates requests and identifies
  nobody.

  Every request now gets a `Server-Timing` response header — `total`-only by
  default — stamped from Nitro's `beforeResponse` hook.
  `useRequestTiming(event, options?)` (h3/Nitro) and the `timing` argument
  `logRequest` now passes to its handler (`./worker`) return a `RequestTiming`
  instance: `mark(name, description?)` closes the phase running since the
  previous mark and starts the next one, and `measure(name, work)` wraps a
  callback the same way. Named phases and their descriptions only reach the
  header once a route opts in via `exposePhases` (or the plugin-level
  `timingExposePhases`), so a public route never leaks internal phase names or
  whatever a caller put in a description unless it explicitly decides that's
  fine. Descriptions are reduced to printable ASCII and the rendered header is
  bounded to 32 phases and 2 KB. An upstream `Server-Timing` is appended to, not
  replaced.

  A response a shared cache may replay (`public`, `s-maxage`, `immutable`,
  unless `private`/`no-store` overrides) carries neither `x-request-id` nor
  `Server-Timing`: a cached per-request identity would be served to every later
  client.

  `RequestLoggingOptions.slowRouteThresholdMs` (h3/Nitro) and
  `LogRequestOptions.slowRouteThresholdMs` (worker) are unset by default. Set
  one to get a single structured `warn` "Slow route" log line for a request over
  budget, carrying the route template, method, status, duration, and request ID
  — never the raw URL, query string, or headers. It honours `skipPaths` and
  `requestLogging: false`, so a silenced route stays silent; a 5xx stays
  visible.

  Left out of this change: the `D1Probe` statement/round-trip counter contract
  narduk-libs#325 also proposes. It is Cloudflare-D1-specific and needs its own
  design pass; `RequestTiming.mark`'s optional `description` already lets an app
  compute its own counts (statements, round trips, whatever it tracks) and pass
  the formatted string straight through, without narduk-logging knowing anything
  about D1. Refs #325.

### Patch Changes

- 384925d: Redact API-key and credential field names that survive
  punctuation-stripping, such as `x-api-key`, `openai_api_key`,
  `AWS_SECRET_ACCESS_KEY`, and JWT assertion headers.

  Matching now splits the original key on camelCase, snake_case, and kebab-case
  and treats `token`/`secret`/`jwt`/`bearer` as whole segments, so `tokenizer`,
  `tokenization`, `secretary`, and `jwtid` stay visible. Compound infixes
  (`apikey`, `accesskey`, `privatekey`, `authorization`) still match on the
  punctuation-stripped key, so `x-api-key` and `AWS_SECRET_ACCESS_KEY` stay
  redacted. A key that _ends_ in `token`, `password`, or `secret` stays redacted
  as before, because segment splitting sees no boundary in an all-lowercase
  concatenation such as `refreshtoken`, `dbpassword`, or `apisecret`.
  `authorName`, `tokenCount`, `passwordless`, `authMethod`, `authBackend`, and
  `authProvider` stay visible. An explicit `redact` extra list still wins over
  those carve-outs. TypeScript, Python, and Swift stay in step.

## 0.1.1

### Patch Changes

- 3ab7ff2: Emit the `Request completed` summary on failing requests, not only
  successful ones.

  `installNitroLogging` completed every request from the `afterResponse` hook
  and had the `error` hook defer to it. That boundary is unreachable on a
  failing request: h3's app sends the error response from its own `onError`
  handler, sees `event.handled`, and returns without calling `onAfterResponse` —
  in both the Node listener and the fetch handler the Cloudflare Worker artifact
  is built from. A handled 5xx and an unhandled 500 therefore produced no
  summary at all, and an unrouted path produced no record of any kind, because
  the deferral was also gated on `status >= 500`.

  The `error` hook now completes the record itself, using the status the error
  handler is about to send; the existing once-per-request flag keeps a runtime
  that does reach `afterResponse` from emitting a second one. Every request now
  produces exactly one summary with `status`, `durationMs` and `requestId` on
  success, on a handled error and on an unhandled error, in both runtimes.

  The record shape is unchanged, so this is a patch. A 5xx summary still carries
  the canonical `error` object; a 4xx summary still omits it, because the
  framework's own 4xx message quotes the raw request target that the route
  template deliberately keeps out of records. `requestLogging: false`,
  `skipPaths` (which still never suppress a 5xx), redaction and level handling
  are untouched.

- 119042d: Move the optional `@opentelemetry/*` peer and dev ranges from the
  0.208 / 2.x-early line to `^0.222.0` / `^2.11.0`.

  The experimental `0.2xx` packages pin their stable siblings exactly, so
  `^0.208.0` forced `@opentelemetry/core@2.2.0` on every consumer that opts into
  the OTLP sink. That version carries GHSA-8988-4f7v-96qf (unbounded memory
  allocation in W3C Baggage propagation, medium), first fixed in
  `@opentelemetry/core@2.8.0`. `@opentelemetry/sdk-logs@0.219.0` is the first
  experimental release pinning `2.8.0`; `0.222.0` is the current matched line
  and resolves `@opentelemetry/core@2.11.0`.

  The generator is released alongside it because its manifest hard-codes the
  exact pins of the packages this release moves.

  The peers stay optional, so a consumer that never calls `createOtlpSink` is
  unaffected. The sink's API surface — `LoggerProvider({ processors })`,
  `OTLPLogExporter`, `SeverityNumber`, `ReadableLogRecord` — is unchanged across
  the move.

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

## 0.1.0

- Initial TypeScript, Python, and Swift logging APIs sharing schema version 1.
- Sanitized records, immutable context, operation summaries, bounded optional
  delivery.
- Nuxt/H3, Workers, Node, browser, stdlib, Dagster, shell, and OSLog adapters.
- Compatibility bridge and new-app generator integration with adoption
  documentation.
