/**
 * Published narduk-core module entry. Applies `narduk-core:csp` contributions
 * immediately before the existing setup resolves and installs the estate
 * policy, so a downstream module can add a script origin without forking
 * `security-headers.ts` (narduk-libs#410).
 *
 * `defineNuxtModule` returns a function that closes over `setup` and does
 * not expose it. Tests mock `defineNuxtModule` as identity, so they only
 * have `setup`. Both shapes are wrapped here.
 */
import { applyCspContributionPoint } from './csp-contributions'
import core from './module'

import type { CspContributionNuxt } from './csp-contributions'
import type { NardukCoreModuleOptions } from './module'
import type { Nuxt } from '@nuxt/schema'

function asCspNuxt(nuxt: Nuxt): CspContributionNuxt {
  return nuxt as unknown as CspContributionNuxt
}

type ModuleSetup = (options: NardukCoreModuleOptions, nuxt: Nuxt) => unknown

interface ResolvableModule {
  getOptions?: (
    inlineOptions?: NardukCoreModuleOptions,
    nuxt?: Nuxt,
  ) => NardukCoreModuleOptions | Promise<NardukCoreModuleOptions>
  setup?: ModuleSetup
}

function wrapPublishedModule(mod: typeof core): typeof core {
  const resolvable = mod as typeof core & ResolvableModule
  if (typeof resolvable === 'function' && typeof resolvable.getOptions === 'function') {
    const getOptions = resolvable.getOptions.bind(resolvable)
    const wrapped = Object.assign(async function nardukCore(
      inlineOptions: NardukCoreModuleOptions,
      nuxt: Nuxt,
    ) {
      const options = await getOptions(inlineOptions, nuxt)
      await applyCspContributionPoint(options, asCspNuxt(nuxt))
      return resolvable(options, nuxt)
    }, resolvable)
    return wrapped as typeof core
  }

  if (typeof resolvable.setup === 'function') {
    const originalSetup = resolvable.setup.bind(resolvable)
    resolvable.setup = (async (options: NardukCoreModuleOptions, nuxt: Nuxt) => {
      await applyCspContributionPoint(options, asCspNuxt(nuxt))
      return originalSetup(options, nuxt)
    }) as typeof resolvable.setup
  }
  return resolvable
}

export default wrapPublishedModule(core)
export type { NardukCoreModuleOptions } from './module'
