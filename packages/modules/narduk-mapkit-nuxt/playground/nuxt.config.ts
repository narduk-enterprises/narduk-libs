export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-mapkit-nuxt'],
  compatibilityDate: '2026-07-14',
  devtools: { enabled: false },
  nitro: {
    cloudflare: {
      // This fixture proves the module does not require Cloudflare's Node.js
      // compatibility layer. Keep this explicit so Nitro does not emit its
      // generic "compatibility is not enabled" advisory.
      nodeCompat: false,
    },
  },
  sourcemap: false,
  vite: {
    build: {
      modulePreload: { polyfill: false },
    },
  },
})
