export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-core/nuxt', './src/module'],
  typescript: {
    tsConfig: {
      // This package ships no `app/` tree, so Nuxt treats the package root as
      // srcDir and generates `include: ['../**/*']`. That is what puts
      // `src/module.ts` in a project for typed linting — but it also drags the
      // flat ESLint config, and through it the untyped `.mjs` sources of
      // @narduk-enterprises/eslint-config, into `nuxt typecheck`. Excluding the
      // config file keeps both: typed lint coverage of everything published,
      // and a typecheck scoped to this package's own sources.
      exclude: ['../eslint.config.mjs'],
    },
  },
})
