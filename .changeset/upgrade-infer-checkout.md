---
'@narduk-enterprises/create-narduk-app': patch
---

`upgrade` reads the checkout it is pointed at: root Nuxt app versus `apps/web`, the wrangler file that exists (`wrangler.json`, `wrangler.jsonc`, or `wrangler.toml`, or `nativeManifests.wrangler`), and a literal `devServer.port` (comments and nested objects do not count). `databaseBackend` comes from the Nuxt config or a D1 binding. An existing migrate command is left alone. Auth inferred from `@narduk-enterprises/narduk-auth` is not dropped when no D1 binding is found. `--only apps/web/wrangler.jsonc` selects the checkout's wrangler file.
