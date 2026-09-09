# @narduk-enterprises/narduk-realtime

Durable Object build wiring and a hibernating WebSocket base class for Narduk
Cloudflare apps.

Two things, both small:

- a **Nuxt module** that re-exports your Durable Object classes from the built
  Cloudflare Worker entry, so `wrangler`'s
  `durable_objects.bindings[].class_name` resolves; and
- a **`HibernatingDurableObject` base class** that gets the hibernation and
  session-accounting details right by default.

Nothing here runs at request time. The module is build-time only, and the base
class adds no runtime dependency.

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
