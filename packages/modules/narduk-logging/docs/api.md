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
`requestRoute(event)`, `installNitroLogging(nitro, optionsFactory)`,
`useRequestTiming(event, options?)`, `requestIdHeaders(id)`, and
`defineClientLogHandler(options)`. A configured Nitro plugin supplies options;
standalone H3 callers provide them explicitly. Incoming IDs accept only
`[a-zA-Z0-9._:-]`, 1–128 characters; a request with no valid ID header falls
back to a valid `cf-ray` (so it still correlates with Cloudflare's own edge
trace), then to a generated UUID. That charset and bound are a safety property,
not a trust one: they guarantee the value cannot inject a header or a log field,
and they guarantee nothing about where it came from. A public route's inbound
`x-request-id` — and its `cf-ray`, on any path that does not actually traverse
Cloudflare — is chosen by the caller, so a client can pin many requests to one
ID or reuse an ID it saw elsewhere. Correlate with it; never treat it as
evidence of identity, and never authorize on it. The response contains
`x-request-id`. An early middleware may create the ID without creating a logger.
Completion uses the final matched route template or `/[unmatched]`.
`requestIdHeaders(id)` returns `{ 'x-request-id': id }` to forward on an
outbound call — for example to a `narduk-data` fetch — so a slow upstream stays
traceable from the same ID.

`requestLogging: false` suppresses successful summaries; failures remain visible
unless the level suppresses them. `skipPaths` replaces the default noise list:
`/_nuxt/`, `/__nuxt`, `/favicon`, `/api/health`, and `/api/_narduk/logs`.
Slash-suffixed custom entries are prefixes; other custom entries are exact
paths. The two core framework prefixes retain their legacy prefix behavior.

### Server-Timing and slow-route logging

Every request gets a `Server-Timing` response header with at least
`total;dur=<ms>`, whether or not the route touches timing — stamped from Nitro's
`beforeResponse` hook, the last point at which the response headers are still
open. Two exceptions: a response whose `cache-control` lets a _shared_ cache
store it (`public`, `s-maxage`, `immutable`, and not overridden by `private` or
`no-store`) is left alone, along with its `x-request-id`, because a cache would
replay one request's identity to every later client; and an upstream
`Server-Timing` is appended to rather than replaced. Call
`useRequestTiming(event, { exposePhases? })` from a route to get the request's
`RequestTiming` instance and call `mark(name, description?)` to close the phase
running since the previous mark (or since the request started) and start the
next one, or `await measure(name, work)` to wrap a callback the same way.
`exposePhases` (default `false`, or `RequestLoggingOptions.timingExposePhases`
from the Nitro plugin config) controls whether marked phases — and whatever a
`description` says — are rendered in the header, or only the aggregate `total`.
Leave it off for a public route whose phase names or descriptions would leak
internal shape (a DB table, a subsystem name); a route the app has decided is
fine to detail can opt in. A phase name must match `[\w-]{1,64}`; a description
is sanitized down to printable ASCII (everything outside `[\x20-\x7e]` is
removed, along with the `"`, `\` and `,` that would break the header grammar)
and truncated to 128 characters, then rendered as
`name;dur=<ms>;desc="<description>"`. The non-ASCII rule is load-bearing: a
header value is a ByteString, so a description carrying an accented word or an
emoji would make `Headers.set`/`res.setHeader` throw and turn the response into
a 500. At most 32 marked phases are rendered and the whole header stays under 2
KB, whichever bound is reached first; elapsed time keeps accumulating into
`total` regardless.

#### Statement and round-trip counts

Every `RequestTiming` owns a `QueryCounter` (`timing.counter`; on h3,
`useRequestCounter(event)` returns the same object). The counter is
driver-agnostic: the wrapper around a data binding calls
`recordRoundTrip(statements = 1)` once per call into the binding, passing the
number of statements that call executed — `1` for one query or a D1
`first`/`all`/`run`/`raw`, `statements.length` for a D1 `batch`. Statements and
round trips are separate counts because they have separate fixes: batching eight
reads moves round trips and leaves statements where they were. Recording never
throws; a malformed count is floored to a non-negative integer.

Once anything has been counted, and only when phases are exposed, each marked
phase without an explicit description renders its own delta and `total` renders
the request's cumulative counts, separated by `/` rather than a comma
(`Server-Timing` is itself a comma-separated list):

```
auth;dur=0;desc="0 stmt / 0 rt", scope;dur=17;desc="1 stmt / 1 rt",
board;dur=274;desc="18 stmt / 11 rt", total;dur=305;desc="20 stmt / 13 rt"
```

The "Request completed" and "Slow route" records carry `statements` and
`roundTrips` whenever something was counted, whether or not phases are exposed;
a request that counted nothing logs exactly the fields it always did. No
`timing-allow-origin` is ever set, so a cross-origin page's Resource Timing API
never sees these values.

`RequestLoggingOptions.slowRouteThresholdMs` (and `LogRequestOptions` on
`./worker`'s `logRequest`) is unset by default — no line is ever emitted. Set it
to get one structured `warn` "Slow route" log line per request whose total
duration exceeds it, carrying the route template, method, status, duration, and
request ID already bound to the request logger — never the raw URL, query
string, or headers. It obeys the same silencing as the completion summary: a
path matched by `skipPaths` or a host with `requestLogging: false` gets no slow
line either, so a slow asset or health probe cannot flood the log. A failing
request (5xx) stays visible on both, as it does for the summary.

Inside a Cloudflare Worker, wall time only advances across I/O: workerd suspends
the CPU clock between awaits, so a CPU-bound phase with no I/O in it reports
close to zero regardless of how long it actually ran. Treat a phase's duration
as "time this phase waited on something external," not as a CPU profile.

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
`logRequest(request, logger, handler, options?)`,
`logJob(logger, name, handler, fields?)`, and `requestIdHeaders(id)`. Supply a
route template via `options.route`; the library never extracts a raw URL path
automatically. `handler` receives `(log, timing)` — the second argument is the
request's `RequestTiming`, the same API `useRequestTiming` returns for `./h3`.
`options.timingExposePhases` and `options.slowRouteThresholdMs` mirror
`RequestLoggingOptions` above, including the same defaults (phases hidden,
slow-route logging off) — see "Server-Timing and slow-route logging".
`logRequest` sets both `x-request-id` and `server-timing` on the response,
cf-ray fallback included, under the same shared-cache exception described above.
HTTP response bodies remain streamed. Queue acknowledgments and retries remain
the handler's decisions.

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

Go uses `narduklogging.NewHandler(w, Options{Service, Environment})` or
`NewLogger`. The handler implements `slog.Handler` and writes one schema JSON
record per line. It never calls `slog.SetDefault`. `slog.Level` maps onto the
schema enum (`<debug` → `trace`, `debug`, `info`, `warn`, `error`, `error+4` →
`fatal`). Root attributes named `requestId`, `operationId`, `method`, `path`,
`traceId`, `spanId`, `source`, and `error` lift to the canonical top-level
fields; everything else is the sanitized `data` object. OTLP export and
framework bridges stay out of this adapter.

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
