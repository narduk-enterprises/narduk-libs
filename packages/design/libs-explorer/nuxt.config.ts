/**
 * Narduk Libs Explorer — increment 1 of docs/plans/libs-explorer-plan.md.
 *
 * Prerendered: every page is generated from the workspace inventory at build
 * time, and `failOnError` plus link crawling makes an unresolvable catalog or
 * demo route a build failure. The Cloudflare Workers target (and the MapKit
 * token route that needs a server) arrive with increments 3 and 4.
 */
export default defineNuxtConfig({
  compatibilityDate: '2026-09-09',
  modules: ['@nuxt/ui', '@narduk-enterprises/narduk-shell', '@nuxt/eslint'],
  css: ['~/assets/explorer.css'],
  devtools: { enabled: false },
  telemetry: false,
  ui: { fonts: false },
  nitro: {
    preset: 'static',
    prerender: {
      routes: ['/'],
      crawlLinks: true,
      failOnError: true,
      // A demo's own destinations (NeAppShell's rail) live under /example/:
      // they are the demo app's routes, not the explorer's, so the dead-link
      // crawl skips them rather than failing on them.
      ignore: ['/example/'],
    },
  },
  app: {
    head: {
      title: 'Narduk Libs Explorer',
      htmlAttrs: { lang: 'en' },
      meta: [
        {
          name: 'description',
          content:
            'Components, foundations and the package catalog of the Narduk shared libraries.',
        },
      ],
    },
  },
})
