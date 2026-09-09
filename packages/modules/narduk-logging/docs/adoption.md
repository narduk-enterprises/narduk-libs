# Adopt logging one app at a time

Each app owns its configuration, collection enrollment, and rollback. Installing
this package never provisions infrastructure, changes a Cloudflare subscription,
or creates a continuing synchronization relationship with `narduk-libs`.

## Existing narduk-core apps

1. Install the released compatible core version and pin the logging release to
   `0.1.0` with the app's process-scoped GitHub Packages read access. Commit the
   resulting lockfile after validating the packed/released artifact.
2. Keep existing logger imports and `useLogger(event)` calls. Set
   `runtimeConfig.nardukLogging.service` and `.environment` explicitly. Existing
   `LOG_LEVEL` and `runtimeConfig.logLevel` behavior remains; the bridge's
   fallback is `warn` in production and `debug` in development. Opt into `info`
   explicitly when ready for request summaries.
3. Emit `log.info('Synthetic logging check', { check: 'adoption' })` at an
   enabled level. Verify trusted service/environment, one request-completion
   summary, and the same `x-request-id` in the response and records. Check a
   deliberate failure and `LOG_LEVEL=silent` as well.
4. Enable collection only after destination delivery is verified. Cloudflare's
   native OTLP export requires Workers Paid and remains beta; do not change a
   subscription as a side effect. Preserve existing Cloudflare persistence
   settings and start with full log sampling. Managed hosts use their Alloy
   collector; standalone processes can opt into the official OTLP exporters.
5. Remove app-local copied logger implementations, response `finish` listeners,
   and duplicate error plugins. Core and the standalone logging module share one
   Nitro installation guard. Do not replace product-specific error handling.
6. Record the previous package pins, configuration, collection destination, and
   verification procedure. Roll back by restoring those versions/configuration,
   rebuilding, and reverting the app-owned collection change. Keep only one
   request-summary implementation active.

Old `Logger`/`LogLevel` types, imports, `message/data` calls, and nested
`child('scope')` message prefixes remain. Records keep timestamp, level,
requestId, method, path, message, and data where applicable, and gain the
canonical identity fields. Intentional privacy changes: automatic paths become
templates (or `/[unmatched]`), queries/bodies/credentials are omitted, error
details use the canonical `error` object, and production error stacks are off.
Summaries use a fixed `Request completed` message with `data.status` and
`data.durationMs`. Update queries that previously parsed request text or
`data.duration`.

## Copied TypeScript loggers and console calls

1. Install pinned `@narduk-enterprises/narduk-logging@0.1.0`.
2. Configure service, environment, and the runtime adapter; use Node stderr for
   CLI diagnostics. Add the shared path before deleting an existing utility.
3. Run a synthetic event, an exception/cause case, and a redaction case through
   the published entry point. Compare request context under overlapping
   requests.
4. Enable the app's collection route and find the event using its correlation
   ID.
5. Replace `console.*` calls deliberately with fixed messages and structured
   data. Remove duplicated instrumentation; never patch global console.
6. Retain prior dependency pins and the small app-local adapter until
   verification is complete; restore them and disable the new destination for
   rollback.

## Python logging, services, CLI, and Dagster

1. Download the pinned `narduk-logging` wheel from the private GitHub release,
   verify its checksum, and install it into the app's environment as documented
   in [releases](releases.md). Pin the resulting artifact in the app lockfile.
2. Configure `create_logger(service=..., environment=...)`. For existing calls,
   install `install_stdlib_handler(log, target=the_app_logger)` and retain its
   undo function. For Dagster, register `create_dagster_logger(log)` and select
   that logger in run configuration; do not add a second root handler.
3. Verify a synthetic application event once, with run/job/step/asset context
   where applicable. CLI logs must be on stderr with stdout left available.
4. Enable host Alloy or the optional official OTLP exporter and find the event.
5. Remove duplicate old handlers deliberately. Preserve Dagster's event storage;
   the adapter emits logs and never calls `context.log` recursively. Existing
   stdlib `extra` data belongs under `narduk_data` for the bridge.
6. Undo the bridge, restore prior handlers/dependency lockfile, and disable the
   new collection path to roll back. Call `close()` or `await aclose()` at
   shutdown.

## Swift print, OSLog, services, and native apps

1. Pin SwiftPM to the repository's `v0.1.0` tag and product `NardukLogging`.
   Confirm the compiler and OS minimums in the support matrix first.
2. Create an explicit logger with service/environment and an `OSLogSink` or
   `StreamSink`. Convert `print` diagnostics to structured fields; preserve
   command results on stdout. Use `.private(value)` for sensitive data or
   `LogPrivacy.private` with `asSwiftLog()` metadata.
3. Verify one synthetic event and redaction in OSLog or JSON output. Test an
   asynchronous operation failure and concurrent bound contexts.
4. Enable host collection for services, or explicitly create a native app
   diagnostics sink after app-level enablement/consent and endpoint validation.
5. Remove duplicate `print`/OSLog wrappers and old remote sinks. Do not
   bootstrap global swift-log configuration to adopt one feature's logger.
6. Close the new sink, restore the old SwiftPM pin/configuration and app-owned
   logging adapter, and disable the new client endpoint for rollback.

## New apps

`create-narduk-app` emits pinned dependencies, explicit service identity, an
`info` default, request summaries, and `docs/logging.md` with a copyable
synthetic route example. It performs no enrollment, secret retrieval, or remote
mutation. Run the same verify → collection → duplicate-removal → rollback
sequence before shipping the generated app.
