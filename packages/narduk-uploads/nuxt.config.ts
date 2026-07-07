export default defineNuxtConfig({
  srcDir: 'runtime',
  modules: [
    '@narduk-enterprises/narduk-core/nuxt',
    ['./src/module', { imports: false, server: false }],
  ],
})
