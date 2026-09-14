// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import { PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE } from '@narduk-enterprises/eslint-config/config/server'
import { createAppLintConfig } from '@narduk-enterprises/eslint-config/eslint-app-config'
import { nardukTemplateStrictCapabilityPacks } from '@narduk-enterprises/narduk-core/eslint-capability-packs'

/**
 * Portable-layer server-import allowance — same reasoning as narduk-auth and
 * narduk-ai: a published layer has no `#server/*` alias for its own sources, so
 * its server modules reach their own `server/utils` and `shared/` siblings
 * relatively. The shared constant drops exactly that one pattern group and
 * keeps the Node-built-in and other-layer bans.
 */
export default createAppLintConfig({
  withNuxt,
  capabilityPacks: [...nardukTemplateStrictCapabilityPacks],
  extraOverrides: [
    {
      name: 'narduk-devices/portable-layer-internal-server-imports',
      files: ['server/**/*.ts'],
      rules: {
        'no-restricted-imports': PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE,
      },
    },
  ],
  seoMode: 'disabled',
})
