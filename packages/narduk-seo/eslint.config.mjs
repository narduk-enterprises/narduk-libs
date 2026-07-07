// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import { composeSharedConfigs } from '@narduk-enterprises/eslint-config/config'
import { nardukTemplateStrictCapabilityPacks } from '@narduk-enterprises/narduk-core/eslint-capability-packs'
import {
  importXVueCoreModuleFragment,
  redundantNuxtAutoImportFlatConfig,
} from '@narduk-enterprises/narduk-core/eslint-nuxt-flat-fragments'

const sharedConfigs = composeSharedConfigs(...nardukTemplateStrictCapabilityPacks)

export default withNuxt(
  ...sharedConfigs,
  redundantNuxtAutoImportFlatConfig,
  importXVueCoreModuleFragment,
)
