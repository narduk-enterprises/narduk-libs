# @narduk-enterprises/narduk-realtime

Durable Object build wiring and a hibernating WebSocket base class for Narduk
Cloudflare apps.

Three things, all small:

- a **Nuxt module** that re-exports your Durable Object classes from the built
  Cloudflare Worker entry, so `wrangler`'s
  `durable_objects.bindings[].class_name` resolves;
- an **upgrade router** that routes a `Upgrade: websocket` request to one of
  those objects with your own authorisation, without crossws and without
  `nitro.experimental.websocket`; and
- a **`HibernatingDurableObject` base class** that gets the hibernation and
  session-accounting details right by default.

The module is build-time only and the base class adds no runtime dependency. The
upgrade router is the one part that runs at request time, and only for a request
whose path you declared and whose `Upgrade` header says `websocket`.

## Install

```bash
pnpm add @narduk-enterprises/narduk-realtime
```

## Nuxt module

```ts
// apps/web/nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-realtime'],
  realtime: {
    durableObjects: {
      VesselDO: './server/durable/vessel-do',
    },
    upgrades: [
      {
        path: '/api/app/vessels/:vesselId/live',
        binding: 'VESSEL_DO',
        idFrom: 'vesselId',
        authorize: './server/upgrades/vessel-live',
      },
    ],
  },
  nitro: { preset: 'cloudflare_module' },
})
```

The module option key is **`realtime`**. Each `durableObjects` entry maps an
**exported class name** — used verbatim in the generated `export { … }` and in
your wrangler binding — to the **module that exports it**. A path starting with
`.` (or an absolute one) is resolved from the app's `rootDir`, with `.ts`,
`.mts`, `.js`, `.mjs` and `index` variants probed, so the extension is optional.
Anything else is treated as a bare package specifier and handed to the bundler
unchanged. A class name that is not a JavaScript identifier, or a relative path
that resolves to nothing, fails at configuration time with the paths that were
tried — not midway through a Cloudflare build.

### What it does

Nuxt builds Nitro twice: once for the prerenderer and once for the deployment
preset. Only the preset build produces the Worker entry with a `default` export.
On that build only, the module writes
`<buildDir>/narduk-realtime-worker-entry.mjs`:

```js
export { default } from '<nitro entry>'
export { VesselDO } from '<resolved module path>'
```

and points `rollupConfig.input` at it. Nitro pins the entry chunk name to
`index.mjs`, so the wrangler `main` path is unchanged; the built Worker simply
gains one named export per class. Entries are sorted by class name, so the
generated file is byte-identical across builds of the same configuration.

### wrangler

```jsonc
{
  "main": "./.output/server/index.mjs",
  "durable_objects": {
    "bindings": [{ "name": "VESSEL_DO", "class_name": "VesselDO" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["VesselDO"] }],
}
```

Use `new_sqlite_classes` for a new class: the SQLite-backed storage backend is
the current default for new Durable Object namespaces and the one the free plan
supports. `new_classes` is the legacy key-value backend.

## Routing a WebSocket upgrade to a Durable Object

An h3 route handler in a `cloudflare_module` app can **authorise** an upgrade
but can never **answer** one. Nitro's Cloudflare entry sends every request
through `nitroApp.localFetch`, which rebuilds a `Response` from a mocked Node
response, and a `101` carrying a `webSocket` cannot survive that -- outside
workerd `new Response(null, { status: 101 })` is refused outright.

So `realtime.upgrades` moves that one step into the generated Worker entry,
where the real `Request`, `env` and `ExecutionContext` are in hand:

```text
client ──Upgrade: websocket──▶ Worker entry (this router)
                                 │  1. path matches a declared upgrade?
                                 │  2. authorize(ctx) -- normally a plain GET of
                                 │     your own route, in-process, with cookies
                                 │  3. 2xx? forward; anything else? return it
                                 ▼
                              env.VESSEL_DO.get(idFromName('v-1')).fetch(…)
                                 │
                                 ▼  ctx.acceptWebSocket() -- the only 101
                              101 + webSocket  ──▶ client
```

Anything that is not an upgrade, or whose path you did not declare, reaches
Nitro exactly as it would have without the router installed.

### Option shape

| Key              | Meaning                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- |
| `path`           | h3-style pattern: literal segments and `:param`. Validated at build time. No wildcards. |
| `binding`        | `env` binding name of the Durable Object namespace, as in `wrangler`                    |
| `idFrom`         | a route parameter name from `path`, or `name:<literal>` for one shared object           |
| `authorize`      | module whose `default` export decides the upgrade (optional, but see below)             |
| `forwardHeaders` | headers to forward that the default deny list would drop (e.g. `['cookie']`)            |

Every one of those is checked when the app's configuration loads: a wildcard
path, a duplicate path, a binding that is not a valid binding name, an `idFrom`
that names a parameter the path does not declare, a header in the router's own
`x-narduk-` prefix, and an `authorize` module that does not resolve all fail
`nuxt build` with the option's index in the message -- not at request time on a
deployed Worker.

**A route without `authorize` forwards every upgrade that matches its path.**
That is occasionally what you want (an object that authorises the socket itself
from a signed token in the subprotocol), and otherwise it is an open socket.

### The authoriser

```ts
// apps/web/server/upgrades/vessel-live.ts
import type { UpgradeAuthorizeContext } from '@narduk-enterprises/narduk-realtime'
import { PRINCIPAL_HEADER } from '@narduk-enterprises/narduk-realtime/worker/principal'

import { SessionDescriptorSchema } from '../durable/session'

/**
 * Authorise a viewer's live socket by calling the route the client could call
 * directly -- so `requireOrgRole` and the tenancy guard keep exactly one home.
 */
export default async function authorizeVesselLive(
  context: UpgradeAuthorizeContext,
) {
  const probe = await context.authorizeViaRoute(context.request)
  // 401 / 403 / 404 from the route become the upgrade's own response.
  if (!probe.ok) return probe.response

  const descriptor = SessionDescriptorSchema.safeParse(
    await probe.response.json(),
  )
  if (!descriptor.success)
    return new Response('session descriptor unavailable', { status: 500 })

  return {
    ok: true,
    headers: { [PRINCIPAL_HEADER]: JSON.stringify(descriptor.data) },
  }
}
```

`authorizeViaRoute(request, routePath?)` performs an in-process `GET` of an app
route through Nitro's `localFetch` with the Cloudflare platform context
attached, so the route reaches D1, KV and the session exactly as it would on any
request. Cookies are **kept** -- that is the point. The handshake headers
(`upgrade`, `connection`, `sec-websocket-*`) and every `x-narduk-*` header are
stripped. `routePath` defaults to the upgrade's own path and query; pass a
pattern such as `'/api/app/vessels/:vesselId/session'` to authorise against a
different route and its `:param`s are interpolated from the ones this upgrade
matched.

The verdict is either a `Response` -- returned to the client verbatim, which is
how a refusal reaches it -- or `{ ok: true, headers? }`. An authoriser that
answers `101` is refused with a 500: only the Durable Object may complete a
handshake. An authoriser that throws fails the upgrade with the runtime's own
500; catch inside it if you want a specific refusal.

### What reaches the object

```ts
// apps/web/server/durable/vessel-do.ts
import {
  HibernatingDurableObject,
  principalFromRequest,
} from '@narduk-enterprises/narduk-realtime/server/durable-object'

import { SessionDescriptorSchema } from './session'

export class VesselDO extends HibernatingDurableObject {
  override async fetch(request: Request): Promise<Response> {
    const descriptor = SessionDescriptorSchema.safeParse(
      principalFromRequest(request),
    )
    if (!descriptor.success) return new Response('forbidden', { status: 403 })

    // The object is addressed by name; pin that name on first use and refuse a
    // descriptor that disagrees, so a future caller cannot write another
    // tenant's rows through this object.
    const pinned =
      (await this.ctx.storage.get<string>('vesselId')) ??
      descriptor.data.vesselId
    if (pinned !== descriptor.data.vesselId)
      return new Response('forbidden', { status: 403 })
    await this.ctx.storage.put('vesselId', pinned)

    const [client, server] = Object.values(new WebSocketPair())
    this.acceptTagged(server as WebSocket, [descriptor.data.role])
    return new Response(null, { status: 101, webSocket: client as WebSocket })
  }
}
```

The forwarded request:

- **keeps** `upgrade` and `sec-websocket-protocol`;
- **drops** `cookie`, `authorization`, `proxy-authorization`,
  `proxy-authenticate` and the client-connection headers `connection`,
  `sec-websocket-key`, `sec-websocket-version`, `sec-websocket-extensions`,
  `te`, `trailer`, `transfer-encoding`, `keep-alive` -- workerd pairs the
  object's 101 with the client's connection itself, so forwarding those would
  describe the wrong hop. Name any of them in `forwardHeaders` to keep it;
- **passes everything else through** (`user-agent`, `cf-connecting-ip`, …);
- **strips every inbound `x-narduk-*` header** before the authoriser runs, then
  sets whatever the authoriser returned. That is what makes `x-narduk-principal`
  trustworthy inside the object: a client cannot set one, and `forwardHeaders`
  refuses the prefix at build time. It is trusted for _origin_, not for shape --
  validate the parsed value, as above.

`principalFromRequest(request)` reads it and returns `undefined` when it is
absent or is not JSON, so an object reached any other way simply sees no
principal.

### Leave `nitro.experimental.websocket` off

Do not turn it on. It makes the preset entry hand **every** `Upgrade: websocket`
request to crossws _before_ the h3 app runs, and with no
`defineWebSocketHandler` in the app crossws finds no `upgrade` hook and
completes the handshake unconditionally: an **unauthenticated 101 on every
path**, accepted with `server.accept()` -- a non-hibernating socket pinned in
the Worker isolate for the life of the connection, which is exactly what the
cost rule below forbids. The `resolveDurableStub` option that would redirect it
is read only by `crossws/adapters/cloudflare-durable`; `cloudflare_module`
imports `crossws/adapters/cloudflare`, which has no such option, so an
app-installed resolver is dead code in the built Worker. This router needs none
of it: the flag stays off, no crossws peer is ever created, and the only 101 in
the system comes from `ctx.acceptWebSocket()`.

Under `nuxt dev` the Node adapter and the Miniflare-less dev server have no
Durable Object namespace to forward to, so a live socket is a `wrangler dev` /
deployed-Worker feature. The router is wired only into the Cloudflare preset
build, so `nuxt dev` behaves as if no upgrade were declared.

## `HibernatingDurableObject`

```ts
// apps/web/server/durable/vessel-do.ts
import { HibernatingDurableObject } from '@narduk-enterprises/narduk-realtime/server/durable-object'

export class VesselDO extends HibernatingDurableObject {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.headers.get('upgrade') === 'websocket') {
      const role = url.searchParams.get('role') === 'edge' ? 'edge' : 'viewer'
      const [client, server] = Object.values(new WebSocketPair())
      this.acceptTagged(server as WebSocket, [role])
      return new Response(null, { status: 101, webSocket: client as WebSocket })
    }

    return Response.json(this.sessionCounts(['viewer', 'edge']))
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ) {
    if (this.ctx.getTags(ws).includes('edge')) this.broadcast('viewer', message)
  }
}
```

The constructor installs a `ping`/`pong` auto-response pair. The protected
helpers are:

| Helper                   | Purpose                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `acceptTagged(ws, tags)` | Accept a socket in **hibernatable** mode under the given tags   |
| `socketsWithTag(tag)`    | Every currently attached socket carrying `tag`                  |
| `broadcast(tag, msg)`    | Fan out to those sockets; returns how many accepted the message |
| `sessionCounts(tags)`    | Attached-socket count per tag                                   |

They are `protected` on purpose: a public method on a Durable Object is part of
its RPC surface, and `broadcast` is not something a caller outside the object
should be able to invoke.

`broadcast` swallows a `send` failure on an already-gone peer — the runtime
delivers `webSocketClose`/`webSocketError` for it — so one dead session never
silences the rest. The default `webSocketClose` completes the closing handshake,
substituting a normal closure (1000) for the reserved codes 1005 and 1006, which
`WebSocket#close()` refuses to send. Without an explicit `webSocketClose` a
hibernatable socket stays half-closed until the runtime times it out, which
keeps it in `getWebSockets()` and skews every session count.

## The cost rule

From the company-hq paved-paths `web-cf` stack note (D-PAVED-1):

> A Durable Object hibernates by default and is never on a per-message hot path
> for an idle tenant. A resident object costs about **$4 per month**.

That number is what makes per-tenant objects viable or not, so the two
properties above are load-bearing rather than stylistic:

- sockets are accepted with `ctx.acceptWebSocket()` (via `acceptTagged`), not
  `server.accept()`, so the isolate is evicted while idle and woken by a
  delivered message; and
- keepalive pings are answered by the runtime while hibernated, so an idle
  control socket accrues no duration at all.

Do not add an alarm loop, a timer, or an always-open outbound connection that
keeps one of these objects resident. Steady-state aggregates belong in D1 or KV
on a batch path, not in a woken object.
