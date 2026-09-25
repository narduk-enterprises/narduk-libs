/**
 * Minimal D1 app for `scripts/prove-cf-ssr-d1.mjs` (narduk-libs#49): a page
 * whose SSR `useFetch` reaches a D1-backed route through Nitro's internal
 * fetch, built with the `cloudflare_module` preset narduk-core pins and served
 * as the prebuilt Worker. Not part of the unit suite; it needs a real build.
 *
 * `app`, `coreModules` and `image` are off so the build is the server layer
 * and the D1 path and nothing else.
 */
export default defineNuxtConfig({
  modules: ['../../../src/module'],
  nardukCore: {
    app: false,
    coreModules: false,
    databaseBackend: 'd1',
    image: false,
    server: true,
  },
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2026-01-01',
  telemetry: false,
  devtools: { enabled: false },
})
