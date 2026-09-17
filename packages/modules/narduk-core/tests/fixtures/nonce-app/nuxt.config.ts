/**
 * Minimal app that proves the `security.headers` nonce reaches Nuxt's inline
 * hydration payload. Driven by `scripts/prove-nonce.mjs`, not by the unit
 * suite: it needs a real Nitro build, which is far too slow for `test:unit`.
 *
 * `coreModules` and `app` are off so the build is the security wiring and
 * nothing else -- @nuxt/ui, tailwind and pinia have no bearing on whether a
 * nonce lands on a script tag, and they cost minutes.
 */
export default defineNuxtConfig({
  modules: ['../../../src/module'],
  nardukCore: {
    app: false,
    coreModules: false,
    image: false,
    server: true,
    security: {
      headers: {
        enabled: true,
        enforce: true,
      },
    },
  },
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2026-01-01',
  telemetry: false,
  devtools: { enabled: false },
})
