---
'@narduk-enterprises/narduk-realtime': minor
---

New package: Durable Object build wiring and a hibernating WebSocket base class
for Narduk Cloudflare apps (narduk-libs#171, Phase 1).

Two pieces, both small and both library-owned rather than copied into each app:

- A Nuxt module under the `realtime` config key. `realtime.durableObjects` maps
  an exported class name to the module that exports it; on the Cloudflare preset
  build only (Nuxt builds Nitro twice, and the prerenderer entry has no default
  export) it writes `<buildDir>/narduk-realtime-worker-entry.mjs` re-exporting
  Nitro's default handler plus one named export per class, and points
  `rollupConfig.input` at it. Nitro pins the entry chunk name to `index.mjs`, so
  the wrangler `main` path is unchanged and
  `durable_objects.bindings[].class_name` resolves. Relative module paths
  resolve from the app's `rootDir` with the extension optional; a bad class name
  or an unresolvable path fails at configuration time rather than midway through
  a build.
- `HibernatingDurableObject`
  (`@narduk-enterprises/narduk-realtime/server/durable-object`): installs the
  runtime `ping`/`pong` auto-response, accepts sockets in hibernatable mode with
  tags, and adds `socketsWithTag`, `broadcast` and `sessionCounts` helpers plus
  a default `webSocketClose` that completes the handshake and never echoes the
  reserved 1005/1006 codes. The cost rule it exists to enforce — hibernating by
  default, never on a per-message hot path for an idle tenant, roughly $4/month
  for a resident object (company-hq paved paths `web-cf`, D-PAVED-1) — is
  documented on the class and in the README.

`@nuxt/kit` is the only runtime dependency; `@cloudflare/workers-types` is
type-only.
