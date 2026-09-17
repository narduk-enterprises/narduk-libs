---
'@narduk-enterprises/narduk-testkit': minor
---

Add `@narduk-enterprises/narduk-testkit/server/handlers` — a fake H3 event plus
in-memory Cloudflare KV, R2 and D1 fakes for unit-testing route handlers
without a real Worker runtime.

**The gap.** Every package that ships Nitro route handlers has been
hand-rolling its own `IncomingMessage`/`ServerResponse` pair to build an
`H3Event`, and its own ad-hoc canned KV/D1 stubs, scattered across
`narduk-core`, `narduk-app` and `narduk-auth` tests (see "Follow-ups" below).
This harness centralizes that in one tested, documented place, exported from
its own subpath so Playwright-only consumers of this package don't pull it in.

**`createFakeEvent` / `readFakeEventResponse`.** `createFakeEvent({ method,
path, query, params, headers, body, cookies, context })` builds a real
`H3Event` on top of h3's own `createEvent(IncomingMessage, ServerResponse)` —
the same construction narduk-core's tests already use by hand — so it works
with h3's own `getQuery`, `readBody`, `getRouterParam`, `getHeader`,
`setResponseStatus` and `setHeader` rather than a hand-rolled event shape.
`readFakeEventResponse(event, handlerResult?)` reads back the status, headers
and (JSON-decoded when possible) body a handler wrote, falling back to the
handler's return value when nothing was written directly.

**`createFakeKVNamespace`.** An in-memory `KVNamespace` — `get`/`put`/`delete`/
`list`, `expiration`/`expirationTtl` (backed by an injectable clock for
deterministic tests) and `metadata`.

**`createFakeR2Bucket`.** An in-memory `R2Bucket` — `get`/`head`/`put`/
`delete`/`list` with prefix filtering, cursor pagination and a real MD5 etag.

**`createFakeD1Database`.** A `D1Database` backed by `node:sqlite` (Node 24,
already the monorepo's pinned runtime — no new dependency), so
`prepare().bind().first()/all()/run()/raw()`, `batch()` and `exec()` actually
execute SQL. `batch()` runs inside a real `BEGIN`/`COMMIT`/`ROLLBACK`
transaction, so a failure partway through rolls back every statement in the
batch, matching D1's own all-or-nothing guarantee as far as this fake can
promise it.

**`callHandler`.** `callHandler(handler, eventOptions, { env })` wires the
fakes (or any object) into `event.context.cloudflare.env`, calls the handler,
converts a thrown `H3Error` into the response Nitro's own error handling would
send, and returns the same `{ status, headers, body }` shape as
`readFakeEventResponse`.

**What these fakes do NOT emulate**, spelled out in the README: D1's real
network latency, multi-region consistency and read-replica sessions
(`withSession()` throws); KV's real eventual consistency; R2's multipart
uploads and conditional (`onlyIf`) requests; and the deprecated D1 `dump()`
API (also throws).

**Follow-ups (not done in this PR, to avoid touching narduk-core from this
lane).** This harness is now capable of replacing several ad-hoc fakes
elsewhere in the monorepo:
- `packages/modules/narduk-core/tests/kv-cache.test.ts`'s local `createKV()`
- `packages/modules/narduk-core/tests/auth-api-key-d1.test.ts`'s local
  `createApiKeyDb()` canned D1 stub
- the repeated `createEvent(request, new ServerResponse(request))` pattern in
  `narduk-core/tests/{request-correlation,database-none,exception-capture,
  logger,user-session}.test.ts`, `narduk-app/tests/request-body.test.ts`,
  `narduk-auth/tests/{native-auth-boundary,local-email-runtime}.test.ts` and
  `narduk-logging/tests/adapters.test.ts`
