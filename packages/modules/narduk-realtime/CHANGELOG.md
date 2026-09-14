# @narduk-enterprises/narduk-realtime

## 0.2.0

### Minor Changes

- c358332: Route WebSocket upgrades to a Durable Object from the generated
  Worker entry. `realtime.upgrades` declares each upgradeable route with its
  binding, the route parameter that names the object, and an `authorize` module
  that normally re-uses the app's own guards through an in-process
  `authorizeViaRoute` probe. A refusal is returned to the client verbatim.

  The router fails closed. An entry that declares no `authorize` fails
  `nuxt build` naming the option's index and the field, and only an explicit
  `allowUnauthenticated: true` -- for an object that authorises the socket
  itself -- forwards an unchecked handshake; a hand-written
  `createUpgradeRouter` refuses the same configuration. Only a `GET` is routed,
  so the object never sees a method the authorising probe did not use. Each
  route carries an origin policy, compared before the authoriser: same-origin
  over https by default, an `allowedOrigins` allowlist in its place (`*`
  rejected), and a request with no `Origin` refused unless
  `allowMissingOrigin: true` -- a WebSocket handshake is exempt from CORS, so on
  a cookie-authorised socket that comparison is the only cross-site check there
  is.

  A forwarded request keeps the upgrade headers and `cf`, drops credentials and
  the client-connection headers unless `forwardHeaders` names them, and carries
  only the principal the authoriser returned -- which may only be in the
  router's own `x-narduk-` namespace, any other header name being a 500. Every
  inbound `x-narduk-*` header is stripped from every request the router sees,
  the ones it hands back to the Nitro app included. No 101 is produced outside
  the object's own hibernating `acceptWebSocket`, so
  `nitro.experimental.websocket` and crossws stay out of it.

## 0.1.0

### Minor Changes

- 8b11738: New package: Durable Object build wiring and a hibernating WebSocket
  base class for Narduk Cloudflare apps (narduk-libs#171, Phase 1).

  Two pieces, both small and both library-owned rather than copied into each
  app:

  - A Nuxt module under the `realtime` config key. `realtime.durableObjects`
    maps an exported class name to the module that exports it; on the Cloudflare
    preset build only (Nuxt builds Nitro twice, and the prerenderer entry has no
    default export) it writes `<buildDir>/narduk-realtime-worker-entry.mjs`
    re-exporting Nitro's default handler plus one named export per class, and
    points `rollupConfig.input` at it. Nitro pins the entry chunk name to
    `index.mjs`, so the wrangler `main` path is unchanged and
    `durable_objects.bindings[].class_name` resolves. Relative module paths
    resolve from the app's `rootDir` with the extension optional; a bad class
    name or an unresolvable path fails at configuration time rather than midway
    through a build.
  - `HibernatingDurableObject`
    (`@narduk-enterprises/narduk-realtime/server/durable-object`): installs the
    runtime `ping`/`pong` auto-response, accepts sockets in hibernatable mode
    with tags, and adds `socketsWithTag`, `broadcast` and `sessionCounts`
    helpers plus a default `webSocketClose` that completes the handshake and
    never echoes the reserved 1005/1006 codes. The cost rule it exists to
    enforce — hibernating by default, never on a per-message hot path for an
    idle tenant, roughly $4/month for a resident object (company-hq paved paths
    `web-cf`, D-PAVED-1) — is documented on the class and in the README.

  `@nuxt/kit` is the only runtime dependency; `@cloudflare/workers-types` is
  type-only.
