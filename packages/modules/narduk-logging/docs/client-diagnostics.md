# Client diagnostics and privacy

Client collection is disabled until the app explicitly installs a sink and its
own endpoint. Do not ship Grafana, Alloy, Loki, R2, or producer credentials in a
browser/native bundle. Browser clients use an existing same-origin session;
native clients supply their app's normal session authorization header.

Install `/api/_narduk/logs` with `defineClientLogHandler` from `./h3`, passing
your real authorization and distributed rate-limit functions. The reusable
[handler example](../examples/client-handler.ts) deliberately requires both as
parameters, so copying it cannot create an open endpoint. Configure a short
allowlist of application data fields. Anonymous mode additionally requires
`mode: 'anonymous'`, explicit allowed browser origins, and effective abuse
controls. Origins are not authentication: non-browser callers can forge them.

The server checks method, JSON content type, origin, authorization, and rate
limit before reading a maximum 64 KiB body. It accepts 1–10 schema-valid
records, assigns trusted service/environment/timestamp/request identity, and
sets `source: 'client'`. Client runtime/release/request ID claims are marked as
data. Logs cannot grant privileges or constitute an audit trail. Restrict client
severity in queries using the source field when investigating server incidents.

Response codes are `202` accepted, `400` invalid input, `401` unauthorized,
`403` disallowed origin, `405` wrong method, `413` too large, `415` wrong
content type, and `429` rate limited. Responses have `cache-control: no-store`.
Do not treat a successful response as a durable-storage receipt.

Supplied remote buffers cap pending plus in-flight work at 100 records or 1 MiB
and reject records above 16 KiB. Browser/native batches leave space below 64 KiB
for the envelope and contain at most 10 records. Delivery uses at most three
attempts and deadlines; closing stops acceptance and bounds flushing. Closing or
a page/app suspension can lose logs. Counters expose buffered bytes,
delivered/dropped records, and delivery failures without logging their own
errors. Python custom send callbacks must honor their timeout; Python cannot
forcibly stop a blocked callback thread. Swift custom senders must honor timeout
and cancellation. The provided HTTP senders implement those boundaries.

Every ordinary destination receives sanitized records, including development
console output, OSLog, streams, test sinks, and custom sinks. Credential keys
are matched recursively without case or punctuation. Private markers always
become `[REDACTED]`; built-in personal fields, bodies, cookies, prompts, and
authorization fields are also redacted. URL fields lose credentials, query, and
fragment. Automatic requests use route templates, not identifier-bearing paths.
Cycles, depth, unsupported objects, numeric edge cases, and total size are
bounded. Oversized data becomes a truncation marker.

**Secrets interpolated into message or error text cannot be reliably detected.**
Use fixed messages and safe structured fields. An allowlist cannot make
arbitrary text safe, and a field named `note` can still contain a secret.
Classify sensitive values explicitly; keep error stacks disabled in production
unless investigating a controlled case. Stop a diagnostic sink immediately when
consent is withdrawn.

Keep full provider sampling initially and control volume using `LOG_LEVEL`,
`requestLogging`, and `skipPaths`. Document any later sampling at the app and
collection boundaries: absence of a record then cannot prove absence of an
event. Use a distributed rate limiter for browser/native ingestion, not an
in-memory counter that resets on each Worker isolate.
