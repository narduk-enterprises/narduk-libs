/**
 * Built consumer for narduk-libs#1379. `tests/icon-css-scan.test.ts` builds it and loads it in
 * Chromium to prove icons paint the same with and without the css-mode stylesheet scan, and that
 * the scan no longer runs when every icon's CSS is already inline from SSR.
 */
export default defineNuxtConfig({
  modules: ['../../../src/module'],
  css: ['~/assets/css/main.css'],
  nardukCore: {
    app: false,
    auth: false,
    coreModules: true,
    databaseBackend: 'none',
    image: false,
    server: false,
  },
  fonts: { providers: { google: false, googleicons: false, bunny: false, fontshare: false } },
  nitro: { preset: 'node-server' },
  // Unminified client for CPU profiles that must name functions.
  vite: { build: { minify: process.env.ICON_SCAN_FIXTURE_NOMINIFY ? false : undefined } },
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2026-01-01',
  telemetry: false,
  devtools: { enabled: false },
  typescript: { typeCheck: false },
})
