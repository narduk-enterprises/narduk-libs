# Quickstarts

Install a pinned release, configure identity and output, verify a synthetic
event, enable collection, remove duplicate instrumentation, and record rollback.
The [adoption guide](adoption.md) applies that sequence to each runtime.

## Nuxt and H3

Copy [nuxt.config.mjs](../examples/nuxt.config.mjs) into a standalone Nuxt app,
then use this handler:

```ts
import { defineEventHandler } from 'h3'
import { useLogger } from '@narduk-enterprises/narduk-logging/h3'

export default defineEventHandler((event) => {
  useLogger(event).info('Synthetic logging check', { check: 'nuxt' })
  return { ok: true }
})
```

For an existing core app, keep
`@narduk-enterprises/narduk-core/server/utils/logger` and configure
`runtimeConfig.nardukLogging`. For standalone H3, pass explicit logger options
to `useLogger(event, options)` and own request completion in the host lifecycle.
Only a Nuxt/Nitro host can install `installNitroLogging`.

Every request already gets a `total`-only `Server-Timing` header for free. To
break a slow route down, call `useRequestTiming`:

```ts
import {
  useLogger,
  useRequestTiming,
} from '@narduk-enterprises/narduk-logging/h3'

export default defineEventHandler(async (event) => {
  const timing = useRequestTiming(event)
  const session = await timing.measure('auth', () => loadSession(event))
  const board = await timing.measure('board', () => loadBoard(session))
  useLogger(event).info('Board served', { boardId: board.id })
  return board
})
```

See [`docs/api.md`](api.md#server-timing-and-slow-route-logging) for
`exposePhases` and `slowRouteThresholdMs`.

## Workers, schedules, queues, and Durable Objects

[worker.ts](../examples/worker.ts) contains HTTP, scheduled, and queue handlers.
Declare `APP_ENVIRONMENT` in the app's own bindings. Supply the known route
template to `logRequest`; do not pass `request.url`. For Durable Objects, use
`logRequest` inside `fetch` and `logJob` inside `alarm`, with product context
bound using `withContext({ data: ... })`. Keep queue retry/ack logic inside the
handler callback. Structured console records reach the Worker's normal output;
native OTLP collection is a separately configured destination.

## Node services and CLI

Copy [node.ts](../examples/node.ts) outside `node_modules` and run it with Node
22.22+ (`node node.ts` supports erasable TypeScript). Diagnostics go to stderr.
Use `StreamSink`/an explicit stream only when redirecting JSON is intentional.
For remote delivery, install the optional peer dependencies:

```sh
pnpm add @opentelemetry/api-logs@0.208.0 @opentelemetry/sdk-logs@0.208.0 \
  @opentelemetry/exporter-logs-otlp-http@0.208.0 @opentelemetry/resources@2
```

```ts
import {
  createNodeLogger,
  createOtlpSink,
} from '@narduk-enterprises/narduk-logging/node'

const endpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
const token = process.env.LOGGING_PRODUCER_TOKEN
if (!endpoint || !token)
  throw new Error('Logging endpoint and producer credential are required')
const sink = await createOtlpSink({
  endpoint,
  headers: { authorization: `Bearer ${token}` },
})
const log = createNodeLogger({
  service: 'example-node',
  environment: 'production',
  sinks: [sink],
})
log.info('Synthetic logging check', { check: 'node-otlp' })
await log.close()
```

Validate required environment configuration at application startup. The token
above is a server-side producer credential delivered through the estate secret
store, never a browser option or committed file. HTTPS is required except on
loopback; redirects are not a credential-delivery mechanism.

## Browser

Install the app-owned protected route using
[client-handler.ts](../examples/client-handler.ts), supplying actual auth and
distributed rate-limit policies. After app-level enablement, call
`enableDiagnostics(service, environment)` from
[browser.ts](../examples/browser.ts). Retain and call its disposer on teardown
or consent withdrawal. Client collection does not start on import and never
patches `console`.

## Python and shell

Install the wheel using [authenticated release installation](releases.md), then
run [python.py](../examples/python.py). Use
`install_stdlib_handler(log, target=logging.getLogger('my_app'))` to bridge
existing calls explicitly. For optional direct OTLP delivery install the `otlp`
extra and use `from narduk_logging.otlp import create_otlp_sink`. Pass the
authenticated HTTPS endpoint and a server-side header map, then call
`log.close()` at shutdown.

The wheel also installs this command:

```sh
narduk-log --service example-shell --environment production \
  --data '{"check":"shell","count":1}' 'Synthetic logging check'
```

The command emits a single sanitized record on stderr and leaves stdout free. Do
not place secrets in command arguments; recursive field redaction does not
protect process listings or shell history.

## Dagster

Install the `dagster` extra and run
[dagster-job.py](../examples/dagster-job.py). Select the registered logger in
the run configuration:

```yaml
loggers:
  narduk: {}
```

The adapter adds run/job and available step/asset metadata, preserves the
original application message, and does not duplicate events through a root
logger. Dagster's event storage remains independent. Add safe app fields under
`extra={"narduk_data": {...}}`.

## Swift / OSLog / native apps

```swift
.package(url: "https://github.com/narduk-enterprises/narduk-libs.git", exact: "0.1.0")
```

Add `.product(name: "NardukLogging", package: "narduk-libs")` to your target.
Git credentials must already allow access to the private repository. Run the
[stream example](../examples/swift/main.swift) using
`swift run NardukLoggingExample` from this repository.

```swift
import NardukLogging

let log = createLogger(
    try LoggerOptions(service: "example-native", environment: "production"),
    sinks: [OSLogSink(subsystem: "example.native")]
)
log.info("Synthetic logging check", ["check": "native", "identifier": .private("synthetic")])
```

Services/CLI use `StreamSink` on stderr. A native app may explicitly add
`createClientDiagnosticsSink(endpoint:headers:)` after diagnostics enablement,
using its existing app session. Retain the logger and `await log.close()` when
tearing down. The app's endpoint owns authorization and abuse controls, and the
client never contains collector credentials.
