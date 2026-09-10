import { modulePackageTypeScript } from '@narduk-enterprises/narduk-core/nuxt-module-package-config'

export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-core/nuxt', './src/module'],
  // This package ships no `app/` tree, so Nuxt treats the package root as
  // srcDir. See the shared fragment for why the ESLint flat config has to be
  // excluded from `nuxt typecheck` (narduk-libs#176).
  typescript: modulePackageTypeScript(),
})
