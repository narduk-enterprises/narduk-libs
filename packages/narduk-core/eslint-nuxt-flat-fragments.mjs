// @ts-check
// Thin re-export of the shared fragments published by @narduk-enterprises/eslint-config.
// Keeps the `@narduk-enterprises/narduk-core/eslint-nuxt-flat-fragments`
// subpath stable for layers (ai, analytics, layouts, maps, operator, seo, template-*,
// theme-*, uploads) that already import from it.
export {
  importXVueCoreModuleFragment,
  redundantNuxtAutoImportFlatConfig,
} from '@narduk-enterprises/eslint-config/eslint-nuxt-flat-fragments'
