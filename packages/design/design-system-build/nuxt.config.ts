export default defineNuxtConfig({
  compatibilityDate: '2026-09-09',
  modules: ['@nuxt/ui', '@nuxt/eslint'],
  css: ['~/assets/gallery.css'],
  devtools: { enabled: false },
  telemetry: false,
  ui: { fonts: false, colorMode: false },
  nitro: { preset: 'static', prerender: { routes: ['/'] } },
  app: { head: { title: 'NE Base — coded system preview', htmlAttrs: { lang: 'en' } } },
})
