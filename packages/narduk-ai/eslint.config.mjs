// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import { createAppLintConfig } from '@narduk-enterprises/narduk-core/eslint-app-config'
import { nardukTemplateStrictCapabilityPacks } from '@narduk-enterprises/narduk-core/eslint-capability-packs'

export default createAppLintConfig({
  withNuxt,
  capabilityPacks: [...nardukTemplateStrictCapabilityPacks],
  extraOverrides: [
    {
      files: ['server/**/*.ts'],
      name: 'narduk-ai/portable-package-internal-server-imports',
      rules: {
        'narduk/no-relative-server-imports': 'off',
      },
    },
  ],
  seoMode: 'disabled',
})
