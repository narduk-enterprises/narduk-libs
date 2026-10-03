/**
 * Consumer for `tests/performance-defaults-build.test.ts` (narduk-libs#1369):
 * the app names none of the three first-paint defaults, so the build shows what
 * narduk-core ships. `FIXTURE_PERFORMANCE=off` opts out of all three through the
 * module option, and `FIXTURE_APP=1` turns narduk-core's own `app` surface on,
 * all into `FIXTURE_OUT_DIR`, for the comparisons.
 */
const outDir = process.env.FIXTURE_OUT_DIR ?? '.output/default'
const off = process.env.FIXTURE_PERFORMANCE === 'off'

export default defineNuxtConfig({
  modules: ['../../../src/module'],
  nardukCore: {
    app: process.env.FIXTURE_APP === '1',
    auth: false,
    coreModules: true,
    databaseBackend: 'none',
    image: false,
    server: false,
    ...(off
      ? { performance: { componentDetection: false, linkPrefetch: false, resourceHints: false } }
      : {}),
  },
  buildDir: `${outDir}/nuxt`,
  nitro: { output: { dir: `${outDir}/output` } },
  css: ['~/assets/css/main.css'],
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2026-01-01',
  telemetry: false,
  devtools: { enabled: false },
  typescript: { typeCheck: false },
})
