# @narduk-enterprises/narduk-realtime

## 0.2.1

### Patch Changes

- 57ba098: Declare `@nuxt/schema` as a peer dependency in every package whose
  **published** files name it. It was a phantom dependency in all four: declared
  only as a `devDependency`, while the shipped artifact imports it by bare
  specifier — narduk-core's `src/module.ts` (published through `files`),
  narduk-logging's `dist/nuxt.d.ts`, narduk-realtime's `dist/module.d.ts`, and
  narduk-mapkit-nuxt's `dist/module.d.mts` and `dist/types.d.mts`.

  Nothing supplied it to a consumer. `@nuxt/kit@4.5.2` imports `NuxtModule` from
  `@nuxt/schema` in its own `index.d.mts` but declares no `dependencies` entry
  for it and no peers at all, so resolution worked only through pnpm's hidden
  `node_modules/.pnpm/node_modules` hoist or a flat npm/yarn install. A consumer
  on pnpm with a restricted `hoist-pattern`, or a `node-linker` setting that
  suppresses that hoist, got `TS2307: Cannot find module '@nuxt/schema'` when
  type-checking against these packages.

  Rewriting the import to `nuxt/schema` — a subpath of the already-declared
  `nuxt` peer — was tried and rejected. narduk-realtime has no `nuxt`
  devDependency, so `tsc` fails with TS2307 against `nuxt/schema` until one is
  added, and narduk-logging declares no `nuxt` peer at all (its Nuxt entry point
  rests on an optional `@nuxt/kit` peer), so `nuxt/schema` would have been
  exactly as undeclared there as `@nuxt/schema` is today. A `dependencies` entry
  was rejected too: the repo augments `@nuxt/schema`'s interfaces, so the
  consumer must resolve the same instance its own Nuxt does, which only a peer
  guarantees.

  Each range mirrors the package's existing Nuxt peer — `>=3.16.0` for
  narduk-core and narduk-realtime, `>=4.0.0` for narduk-mapkit-nuxt, and
  `^4.0.0` for narduk-logging, matching its `@nuxt/kit` peer. narduk-logging's
  is **optional**, exactly as its `@nuxt/kit` peer is, so a consumer using only
  the node, browser or h3 entry points installs nothing extra. `@nuxt/schema`
  ships as a dependency of `nuxt` itself, so any Nuxt app already has a
  satisfying copy and this declaration adds no install.

  No source file changes: the explicit `NuxtModule` annotations that solved
  TS2742 are untouched, and the emitted types are byte-identical.

- 3ee5e08: Name the module's default export type explicitly. `@nuxt/kit` 4.5.x
  infers `defineNuxtModule`'s return type from `@nuxt/schema` without
  re-exporting `NuxtModule`, so declaration emit could not name it from a bare
  specifier (TS2742). The published `dist/module.d.ts` now imports `NuxtModule`
  from `@nuxt/schema` instead of the deep `nuxt/schema` path TypeScript inferred
  before; the type itself is unchanged.

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
