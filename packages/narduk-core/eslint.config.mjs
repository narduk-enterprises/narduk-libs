// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import { nardukTemplateStrictCapabilityPacks } from './eslint-capability-packs.mjs'
import { createAppLintConfig } from './eslint-app-config.mjs'

export default createAppLintConfig({
  withNuxt,
  capabilityPacks: [...nardukTemplateStrictCapabilityPacks],
  seoMode: 'required',
})
