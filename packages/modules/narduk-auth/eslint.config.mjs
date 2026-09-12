// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import { PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE } from '@narduk-enterprises/eslint-config/config/server'
import { createAppLintConfig } from '@narduk-enterprises/narduk-core/eslint-app-config'
import { nardukTemplateStrictCapabilityPacks } from '@narduk-enterprises/narduk-core/eslint-capability-packs'

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
  extraOverrides: [
    {
      name: 'narduk-auth/portable-layer-internal-server-imports',
      files: ['server/**/*.ts'],
      rules: {
        'no-restricted-imports': PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE,
      },
    },
    {
      // `@vitejs/plugin-vue` trips eslint-plugin-import-x's resolver
      // (`node with invalid interface loaded as resolver`) on
      // `import-x/no-cycle` when this file is linted.
      name: 'narduk-auth/vitest-config-import-resolver',
      files: ['vitest.config.ts'],
      rules: {
        'import-x/no-cycle': 'off',
      },
    },
  ],
  seoMode: 'disabled',
})
