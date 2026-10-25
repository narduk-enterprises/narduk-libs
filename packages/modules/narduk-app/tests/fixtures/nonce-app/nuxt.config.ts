/** Minimal Nuxt app for `scripts/prove-nonce.mjs`; too slow for `test:unit`. */
export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2026-01-01',
  telemetry: false,
  devtools: { enabled: false },
})
