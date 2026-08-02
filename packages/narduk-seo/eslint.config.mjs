// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import { PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE } from '@narduk-enterprises/eslint-config/config/server'
import { createAppLintConfig } from '@narduk-enterprises/eslint-config/eslint-app-config'
import { nardukTemplateStrictCapabilityPacks } from '@narduk-enterprises/narduk-core/eslint-capability-packs'
import {
  importXVueCoreModuleFragment,
  redundantNuxtAutoImportFlatConfig,
} from '@narduk-enterprises/narduk-core/eslint-nuxt-flat-fragments'

// The sanctioned composition path: createAppLintConfig strips the
// Nuxt-managed plugin registrations (@typescript-eslint, vue, nuxt) from the
// shared packs so withNuxt's own instances stay the only ones. Hand-rolling
// withNuxt(...composeSharedConfigs(...)) double-registers them under v2.
/**
 * Portable-layer server-import allowance.
 *
 * v2's `no-restricted-imports` bans relative parent imports inside `server/**`,
 * telling authors to use the `#server/*` alias instead. A Nuxt *app* has that
 * alias; a published *layer* does not have one for its own sources, so this
 * package's handlers reach their own `server/utils` and `shared/` modules
 * relatively and no other spelling exists. The shared constant drops exactly
 * that one pattern group and keeps the rest — a layer must still not import
 * `node:fs`, and must still not reach into another layer's sources.
 *
 * Restating the rule (rather than switching it off) is deliberate: flat config
 * replaces a rule's options wholesale, so `'no-restricted-imports': 'off'` here
 * would silently unban the Node built-ins too.
 */
export default createAppLintConfig({
  withNuxt,
  capabilityPacks: [...nardukTemplateStrictCapabilityPacks],
  // `vue/no-undef-components` reads this package's own `.nuxt/components.d.ts`,
  // which `nuxt prepare` generates with the default `pathPrefix: true`
  // (`shared/LayerNetworkFooter.vue` → `SharedLayerNetworkFooter`). Consumers
  // never see that name: `src/module.ts` registers both component dirs with
  // `addComponentsDir({ …, pathPrefix: false })`, so the consumer-facing name —
  // and the one the templates here must use — is the unprefixed one.
  additionalNuxtUiComponents: ['LayerNetworkFooter'],
  extraOverrides: [
    redundantNuxtAutoImportFlatConfig,
    importXVueCoreModuleFragment,
    {
      name: 'narduk-seo/portable-layer-internal-server-imports',
      files: ['server/**/*.ts'],
      rules: {
        'no-restricted-imports': PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE,
      },
    },
  ],
})
