/**
 * Published-data app with no auth: `coreModules` on, no session secret, no
 * auth package. Driven by `tests/no-auth-session.test.ts` (narduk-libs#540).
 *
 * `coreModules` used to install the session module with its default
 * `server-first` strategy, so every SSR fetched `/api/_auth/session` and
 * logged an unhandled error when the session secret was unset (Buoys).
 */
export default defineNuxtConfig({
  modules: ['../../../src/module'],
  nardukCore: {
    app: true,
    coreModules: true,
    databaseBackend: 'none',
    image: false,
    server: true,
  },
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2026-01-01',
  telemetry: false,
  devtools: { enabled: false },
})
