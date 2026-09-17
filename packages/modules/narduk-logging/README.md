# Narduk Logging

Structured logging for Narduk apps, services, command-line tools, and jobs.
Consola, structlog, and swift-log supply the logging foundations; this package
adds a shared record contract, safe fields, context, runtime adapters, and
bounded optional delivery. Imports do not configure global logging or start
network activity.

```sh
gh-packages-run pnpm add --save-exact @narduk-enterprises/narduk-logging@0.1.0
```

```ts
import { createLogger } from '@narduk-enterprises/narduk-logging'

const log = createLogger({ service: 'feed-loader', environment: 'production' })
log.info('Feed refreshed', { count: 42 })
await log.close()
```

Production defaults to `info`, development to `debug`. `fatal` logs a record; it
does not exit. Use `silent` to suppress every level. Application identity and
environment are explicit; the old core bridge retains its legacy defaults.

Every server request also gets a correlation ID (accepted from a trusted inbound
header, falling back to `cf-ray`, then a generated UUID; see
`requestIdHeaders(id)` to forward it on an outbound call) and a `Server-Timing`
response header. The header is `total`-only by default; opt in per route to
expose named phases, and set a threshold to get a "Slow route" warn log for
requests over budget. See
[`docs/api.md`](docs/api.md#server-timing-and-slow-route-logging).

**Timing inside a Worker:** `Date.now()` and `performance.now()` only advance
across I/O in workerd — the CPU clock is suspended between awaits. A phase that
does synchronous work with no `await` in it will time close to zero no matter
how long it actually took. Don't trust a phase's duration as a CPU profile; it
measures wall time waiting on something external.

| Runtime                   | Support / entry point                         | Output                                                                    |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| Nuxt 4 + Nitro 2 / H3 1   | `./nuxt`, `./h3`                              | Request-scoped console records and lifecycle summaries                    |
| Cloudflare Workers        | `./worker`                                    | Console JSON; HTTP, schedules, queues, Durable Objects                    |
| Node 22+ services and CLI | `./node`                                      | stderr JSON, readable development output, optional official OTLP exporter |
| Modern browsers           | `./browser`                                   | Console; explicitly installed same-origin diagnostics delivery            |
| Python 3.11+              | `narduk_logging`, structlog                   | stderr; explicit stdlib/Dagster bridges, optional OTLP extra              |
| Swift 6.3+                | SwiftPM `NardukLogging`, swift-log            | OSLog or structured streams; optional app endpoint                        |
| Apple OS minimums         | macOS 15, iOS/tvOS 18, watchOS 11, visionOS 2 | Strict concurrency, typed private metadata                                |
| Shell tools               | Python distribution's `narduk-log`            | One JSON record on stderr                                                 |

The JavaScript root has no Nuxt, H3, Node, or browser-global requirement.
Optional framework/exporter dependencies stay behind their entry points. Swift's
stream and core code also build on Linux; OSLog is available only on Apple
platforms. Local development uses Python 3.14.7 and Xcode 26.6 / Swift 6.3.3.

- [Quickstarts and copyable examples](docs/quickstarts.md)
- [API, configuration, and record contract](docs/api.md)
- [Existing-app adoption and rollback](docs/adoption.md)
- [Client diagnostics and privacy](docs/client-diagnostics.md)
- [Searching and troubleshooting logs](docs/operators.md)
- [Packaging and release](docs/releases.md)
- [Canonical JSON Schema](schema/log-record.schema.json) and
  [shared fixtures](schema/fixtures.json)

Use diagnostic logging for investigation. Security audit trails, analytics,
crash reporting, metrics, and distributed tracing have separate durability and
product requirements. Logs and client delivery are best effort.

From the repository root, run `pnpm run quality`. Focused TypeScript checks are
`pnpm --filter @narduk-enterprises/narduk-logging run quality`. Python uses
`uv run python scripts/quality.py` from `python/`; Swift uses
`python3 packages/modules/narduk-logging/scripts/swift-quality.py` from the
root. Release checks additionally install all three packaged artifacts outside
this workspace.
