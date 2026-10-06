/**
 * Consumer for `tests/color-mode-build.test.ts` (narduk-libs#1464): the app
 * states no `colorMode` key, so the build shows what narduk-core ships.
 * `FIXTURE_CLASS_SUFFIX` states one, for the override case. Both build into
 * `FIXTURE_OUT_DIR` and prerender `/`, so the built page can be read.
 */
const outDir = process.env.FIXTURE_OUT_DIR ?? '.output/default'
const classSuffix = process.env.FIXTURE_CLASS_SUFFIX

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
  ...(classSuffix === undefined ? {} : { colorMode: { classSuffix } }),
  buildDir: `${outDir}/nuxt`,
  nitro: { output: { dir: `${outDir}/output` }, prerender: { routes: ['/'], failOnError: true } },
  css: ['~/assets/css/main.css'],
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2026-01-01',
  telemetry: false,
  devtools: { enabled: false },
  typescript: { typeCheck: false },
})
