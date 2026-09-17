# API and record contract

## TypeScript

`createLogger(options)` creates an isolated Consola instance from
`consola/core`. Its reporters receive complete sanitized records, and
repeated-message collapsing is disabled. The existing SEO alias for bare
`consola` cannot redirect this import.

| Option         | Behavior                                                                       |
| -------------- | ------------------------------------------------------------------------------ |
| `service`      | Required nonempty application/service identity, at most 128 characters         |
| `environment`  | Required explicit environment, at most 64 characters                           |
| `runtime`      | Optional runtime label; adapters set `worker`, `node`, or `browser`            |
| `release`      | Optional build or release identity, at most 128 characters                     |
| `level`        | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`                   |
| `format`       | `json` or `pretty`; core defaults to readable development output               |
| `context`      | Request/operation/trace identifiers, method, route template, source, safe data |
| `sinks`        | Explicit destinations; replaces the default console sink                       |
| `redact`       | Additional field names, compared without case or punctuation                   |
| `includeStack` | Default false; enables bounded error stacks                                    |
| `clock`        | Injectable UTC timestamp source for deterministic tests                        |

`trace/debug/info/warn/error/fatal(message, data?)` take fixed message text and
structured data. `child(scope, context?)` and `withContext(context)` return new
loggers with snapshot bindings; they never change the parent or another request.
The modern child stores `scope` as a field. The core compatibility wrapper also
preserves `[scope]` prefixes in message text.

`await log.operation(name, async child => result, data?)` returns the original
result or throws the original exception. It emits an outcome, `durationMs`, and
generated `operationId`. Use `data.error` for a structured exception and cause.

`await log.flush()` and `await log.close()` drive sink lifecycle. Child loggers
share destinations; closing a child closes that logger family. Close the owner
at process shutdown or app teardown, never a shared service logger per request.
`log.diagnostics` snapshots `emitted`, `sinkFailures`, and `dropped` counts.
They are counters to inspect or export as metrics, not recursively log.

```ts
interface LogSink {
  write(record: Readonly<LogRecord>): void
  flush?(): Promise<void>
  close?(): Promise<void>
}
```

`write` must return immediately. Custom network work belongs to a bounded sink.
Records and their nested values are frozen before TypeScript destinations run.
Exceptions from a destination are counted and contained. Custom lifecycle
methods must implement their own deadlines. The supplied remote sinks do so.
`createMemorySink()` from `./testing` retains test records without console
output.

## Framework adapters

`./h3` exports `useLogger(event, options?)`, `ensureRequestId(event)`,
`requestRoute(event)`, `installNitroLogging(nitro, optionsFactory)`, and
`defineClientLogHandler(options)`. A configured Nitro plugin supplies options;
standalone H3 callers provide them explicitly. Incoming IDs accept only
`[a-zA-Z0-9._:-]`, 1–128 characters, otherwise a UUID is generated. The response
contains `x-request-id`. An early middleware may create the ID without creating
a logger. Completion uses the final matched route template or `/[unmatched]`.

`requestLogging: false` suppresses successful summaries; failures remain visible
unless the level suppresses them. `skipPaths` replaces the default noise list:
`/_nuxt/`, `/__nuxt`, `/favicon`, `/api/health`, and `/api/_narduk/logs`.
Slash-suffixed custom entries are prefixes; other custom entries are exact
paths. The two core framework prefixes retain their legacy prefix behavior.

Nitro registration is idempotent across the standalone module and core bridge.
The `request` hook creates context, and every request produces exactly one
completion summary with its status and duration. A successful request is
completed by `afterResponse`; a failing one is completed by the error hook,
because h3 sends the error response from its own handler and then skips
`afterResponse` on that request in both the Node and Worker builds. A summary
carries the canonical `error` object when the status is 5xx; a 4xx summary omits
it, since the error message quotes the raw request target that the route
template deliberately withholds. Explicit background errors after completion
produce a separate captured-error record without repeating the summary.
Unhandled errors without an event use a service logger. `silent` applies to
every path.

`./worker` exports `createWorkerLogger`,
`logRequest(request, logger, handler, { route })`, and
`logJob(logger, name, handler, fields?)`. Supply a route template; the library
never extracts a raw URL path automatically. HTTP response bodies remain
streamed. Queue acknowledgments and retries remain the handler's decisions.

`./node` exports `createNodeLogger` and optional async
`createOtlpSink({ endpoint, headers })`. Install its OpenTelemetry peers before
using the exporter. Output defaults to stderr. `./browser` exports
`createBrowserLogger`, `createRemoteSink`, and reversible
`installErrorHandlers`; it never patches console or auto-installs listeners.
Browser endpoints must be same-origin absolute paths.

The Nuxt module uses `nardukLogging` options and copies them to private
`runtimeConfig.nardukLogging`. Nuxt's `NUXT_NARDUK_LOGGING_*` runtime overrides
remain available. `LOG_LEVEL` overrides the configured level at the Nitro
boundary; core also retains its existing `runtimeConfig.logLevel` fallback. The
framework-neutral root never reads environment variables implicitly.

## Python and Swift equivalents

Python uses `create_logger(service=..., environment=...)`, `with_context(...)`,
`child(scope, **context)`, and the same six levels.
`operation(name, work, data)` is synchronous; `await aoperation(...)` accepts an
asynchronous callback. `flush()` and `close()` are synchronous, bounded for
supplied remote sinks; `await aclose()` runs shutdown off the event loop.
Python's sinks receive separate value copies, preventing one destination from
changing another's record. `install_stdlib_handler(log, target=...)` returns an
undo callback. It does not remove existing handlers; the app removes duplicates
deliberately.

Swift uses
`createLogger(try LoggerOptions(service:environment:), sinks: [...])`,
`withContext(LogContext(...))`, `child`, synchronous/asynchronous overloads of
`operation`, and `await flush()/close()`. `LogValue` supports typed scalars,
arrays, objects, and `.private(value)`. `asSwiftLog()` exposes an isolated
swift-log logger; metadata using `LogPrivacy.private` is removed before output.
Opaque object descriptions are omitted. Swift values and state are Sendable,
with shared state protected by `Synchronization.Mutex`.

## Canonical JSON

```json
{
  "schemaVersion": 1,
  "timestamp": "2026-09-09T00:00:00.000Z",
  "level": "info",
  "message": "Request completed",
  "service": "example-app",
  "environment": "production",
  "runtime": "worker",
  "requestId": "synthetic-request",
  "path": "/items/:id",
  "source": "server",
  "data": { "status": 200, "durationMs": 12 }
}
```

The schema requires the first seven fields above. Optional fields are `release`,
`scope`, `requestId`, `operationId`, `traceId`, `spanId`, `method`, `path`,
`source`, `data`, and `error`. `source` is `server`, `client`, `job`, or `cli`.
Trace and span IDs must be lowercase hexadecimal with 32 and 16 characters
respectively. An error has `name`, `message`, and optional `code`, `stack`,
`cause`. Operation details are in `data.operation`, `data.outcome`, and
`data.durationMs`.

At collection boundaries map `service` to `service.name`, `environment` to
`deployment.environment.name`, `release` to `service.version`, and `runtime` to
`narduk.runtime`. Map severity to OTLP severity text/number and retain the
canonical record as the log body. Only service/environment/runtime/level are
intended index labels. Correlation IDs, paths, and job IDs remain structured
metadata. Provider envelopes must be normalized with an allowlist before
storage.
