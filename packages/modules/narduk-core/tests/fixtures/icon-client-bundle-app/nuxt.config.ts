/**
 * Consumer with no app-level `@nuxt/icon` (narduk-libs#1195).
 * `tests/icon-client-bundle.test.ts` runs `nuxt prepare` here and requires
 * `.nuxt/nuxt-icon-client-bundle` to exist.
 */
export default defineNuxtConfig({
  modules: ['../../../src/module'],
  nardukCore: {
    app: false,
    auth: false,
    coreModules: true,
    databaseBackend: 'none',
    image: false,
    server: false,
  },
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2026-01-01',
  telemetry: false,
  devtools: { enabled: false },
  typescript: { typeCheck: false },
})
