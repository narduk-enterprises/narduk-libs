---
'@narduk-enterprises/create-narduk-app': patch
---

Fix three generated-app defects that made a fresh scaffold fail its own quality
gate (narduk-libs#172 and siblings).

- `apps/web/nuxt.config.ts` emitted a `site: { name, url }` block for every
  capability set, but `site` is a nuxt-site-config key that only reaches the app
  through `@nuxtjs/seo`. A core-only or auth-only scaffold failed
  `nuxt typecheck` with TS2353 on its first run. The block, and the `routeRules`
  prerender entry beside it, are now emitted only for the `seo` capability.
- The committed `.npmrc` carried
  `//npm.pkg.github.com/:_authToken=${GH_PACKAGES_READ}`. pnpm 10 warns
  `Failed to replace env in config` whenever the variable is absent and pnpm 11
  does not expand environment variables in a project `.npmrc` at all, so the
  line is now dropped entirely: the committed file is scope routing only. The
  generated CI workflow instead writes the org secret to a `umask 077`
  userconfig under `$RUNNER_TEMP` and points `NPM_CONFIG_USERCONFIG` at it for
  the install step alone. The generated README documents that path and no longer
  mentions the retired Doppler fallback.
- New `apps/web/server/tsconfig.json` extending `../.nuxt/tsconfig.server.json`.
  The shared eslint config's type-aware pack resolves each file through the
  nearest `tsconfig.json`, and `apps/web/tsconfig.json` extends
  `.nuxt/tsconfig.json`, whose `include` excludes `server/**` — so the first
  server directory an app added (`server/durable/`, `server/tasks/`, ...) failed
  lint with "was not found by the project service".
