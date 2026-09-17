---
'@narduk-enterprises/narduk-core': minor
---

Add `defineValidatedHandler`: a per-route zod contract for Nitro handlers,
alongside the existing `defineRateLimitedHandler`. A route declares `query`,
`params`, `body` and `response` schemas and receives them parsed and fully typed
— it never touches `getQuery`, `getRouterParam` or `readBody`.

A bad request answers **400** with `data.code = 'VALIDATION_FAILED'` and a flat
list of `{ path, message }` rooted at the part it came from (`query.limit`,
`params.stationId`, `body.items[0].name`). **A submitted value never appears in
that body**, in a message or in a path, so a rejected password or token cannot
travel back out through the error. Params and query are checked together so one
response names every bad field; the body is only read once they pass. A body
over `maxBodyBytes` (1 MiB by default) answers **413** before it is parsed, and
a non-JSON `content-type` answers **415**; both carry a `data.code`.

`response` is an assertion, not a transformer: the value the client receives is
exactly what the handler returned, whether or not the check ran, so a route
cannot behave differently in production because validation was skipped. A broken
response contract logs one structured error through
`@narduk-enterprises/narduk-logging` and answers **500** — naming the offending
paths in development and test, opaque in production. Checking is **on in
development and test, off in production by default**: every request on Workers
pays for it in metered CPU on data the server itself produced, and a
response-shape mismatch is a code defect. Opt in with `validateResponse: true`
or sample with `validateResponse: 0.01`.

Composition order with `defineRateLimitedHandler` is an explicit contract:
**rate limit outside, validate inside**, so a throttled caller is rejected
before the body is read or a schema runs. There is deliberately no `rateLimit`
option on this wrapper.

No new dependency: zod 4 is already a direct dependency of this package.
