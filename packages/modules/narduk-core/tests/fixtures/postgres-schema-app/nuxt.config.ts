/**
 * Consumer for `tests/postgres-schema-build.test.ts` (narduk-libs#1953): a
 * server-only Postgres app built twice, once with the default schema and once
 * with `postgresSchema: 'narduk'` (`FIXTURE_SCHEMA`), each into its own
 * `FIXTURE_OUT_DIR`. The route reports the schema the BUNDLED table factory
 * resolved, which is what proves the alias reaches Nitro's real bundle.
 */
const outDir = process.env.FIXTURE_OUT_DIR ?? '.output/default'
const postgresSchema = process.env.FIXTURE_SCHEMA

export default defineNuxtConfig({
  modules: ['../../../src/module'],
  nardukCore: {
    app: false,
    auth: false,
    coreModules: false,
    databaseBackend: 'postgres',
    image: false,
    server: true,
    ...(postgresSchema ? { postgresSchema } : {}),
  },
  buildDir: `${outDir}/nuxt`,
  nitro: { output: { dir: `${outDir}/output` }, preset: 'node-server' },
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2026-01-01',
  telemetry: false,
  devtools: { enabled: false },
  typescript: { typeCheck: false },
})
