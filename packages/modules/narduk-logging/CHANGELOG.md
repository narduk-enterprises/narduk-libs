# Changelog

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
