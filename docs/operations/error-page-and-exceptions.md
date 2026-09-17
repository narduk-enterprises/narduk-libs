# An error page is showing / exceptions are spiking

The branded error page and the exception capture behind it are owned by
[`@narduk-enterprises/narduk-core`](../../packages/modules/narduk-core/README.md#error-page-and-exception-capture),
so every app that pins narduk-core behaves the same way. Apps own nothing here;
an app repository's own runbook should link to this page rather than restate it.

This is a triage guide. It provisions nothing and changes nothing.

## What a user is looking at

The estate error page renders for any unhandled error. It shows the status code,
plain-language copy for the outcome, **Go Home** / **Try Again**, and — the part
that matters for triage — a **request id**.

That request id is the value the `x-request-id` response header carried and the
value every narduk-logging server record for that request is keyed by. Ask the
reporter for it. One id turns "the site broke" into one log line.

Outside production (`previewSafeMode`) the page also prints the raw error
message. In production it never does, so a production report needs the request
id, not a screenshot of a message.

## 1. Decide client or server

| Symptom                                         | Where to look                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| User has a request id                           | narduk-logging records — the failure is server-side or at least reached the server |
| No request id, page appeared after a navigation | PostHog `$exception` with `source = client`                                        |
| Error page on first load, no request id         | SSR never ran: check the deployment, not the app                                   |

## 2. Server side — narduk-logging

One record per failing request, `Request completed`, carrying `requestId`,
`path` (the matched **route pattern**, never a raw URL), `status`, `durationMs`,
`service`, `environment`, and `buildVersion`.

- Search by `requestId` for a single report.
- Group by `path` and `status` for a spike: one route pattern usually owns it.
- Compare `buildVersion` across the spike window. A spike that starts exactly at
  a new `buildVersion` is a release, and the fastest fix is a rollback.

A 5xx also carries the error payload. A 4xx deliberately does not: its message
quotes the raw request target, which the route-template contract keeps out of
records.

If a failing request produces _no_ record at all, that is itself the finding —
report it against narduk-logging rather than working around it. The error path
previously produced no summary; narduk-libs#359 fixed it.

## 3. Client side — PostHog

Exceptions reach PostHog's **Error tracking** product as `$exception`, reported
by narduk-analytics through `posthog.captureException`. Filter on:

- `route` — the matched route pattern
- `status_code`, `fatal`, `source`
- `build_version` — same release-correlation move as above
- `request_id` — present when the client error followed a server request, and
  the join key back to the log record

Nothing is captured when analytics never initialized: no `posthogPublicKey`,
`previewSafeMode` (preview and staging), localhost,
`analyticsLoadStrategy: 'off'`, or a visitor who opted out. "No `$exception`
events" on a preview deployment is expected, not a defect.

## 4. Common causes, in the order they are usually true

1. **A release.** `buildVersion` changes at the spike edge. Roll back first,
   diagnose after.
2. **A backing service.** 5xx concentrated on routes that touch one database, KV
   namespace, or upstream API. Check `/api/health`.
3. **Rate limiting or auth.** A 429 or 401/403 spike is usually a client
   looping, not an outage. The route pattern names the client.
4. **One bad route.** A single `path` owns nearly every record. Read the error
   payload on the 5xx records.
5. **A bot or scanner.** 404s spread across many unmatched paths, no user
   reports. Noise, not an incident.

## 5. What not to do

- **Do not add an app-local `error.vue` or error listener to work around a
  problem.** Fix narduk-core. An app-local copy stops receiving estate fixes,
  and a second listener double-reports every error.
- **Do not add a second reporting pipeline.** Subscribe to the
  `narduk:exception` hook instead — that is what it is for.
- **Do not put the raw error message in front of production users.** The
  `previewSafeMode` gate is deliberate; an unhandled error's message routinely
  quotes internals.

## Related

- narduk-core README →
  [Error page and exception capture](../../packages/modules/narduk-core/README.md#error-page-and-exception-capture)
- narduk-analytics README →
  [Exception reporting](../../packages/modules/narduk-analytics/README.md#exception-reporting)
- narduk-logging →
  [operators guide](../../packages/modules/narduk-logging/docs/operators.md)
