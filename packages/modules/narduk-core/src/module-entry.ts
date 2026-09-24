/**
 * Published narduk-core module entry. Applies `narduk-core:csp` contributions
 * immediately before the existing setup resolves and installs the estate
 * policy, so a downstream module can add a script origin without forking
 * `security-headers.ts` (narduk-libs#410).
 *
 * `defineNuxtModule` returns a function that closes over `setup` and does
 * not expose it. Tests mock `defineNuxtModule` as identity, so they only
 * have `setup`. Both shapes are wrapped here.
 *
 * The function path hands the original module its ORIGINAL inline options
 * plus the contribution, never options it has already resolved: kit's
 * `getOptions` merges inline options with `nuxt.options.nardukCore` and the
 * defaults through defu, which concatenates arrays, so feeding resolved
 * options back in doubled every array in every app's `nardukCore` config
 * (narduk-libs#850 review).
 */
import { hasNuxtCompatibility, tryUseNuxt } from '@nuxt/kit'

import {
  applyCspContributionPoint,
  collectCspContributions,
  withCspContributions,
} from './csp-contributions'
import core from './module'

import type { CspContributionNuxt } from './csp-contributions'
import type { NardukCoreModuleOptions } from './module'
import type { ModuleMeta, Nuxt } from '@nuxt/schema'

function asCspNuxt(nuxt: Nuxt): CspContributionNuxt {
  return nuxt as unknown as CspContributionNuxt
}

type ModuleSetup = (options: NardukCoreModuleOptions, nuxt: Nuxt) => unknown

interface ResolvableModule {
  getMeta?: () => Promise<ModuleMeta>
  getOptions?: (
    inlineOptions?: NardukCoreModuleOptions,
    nuxt?: Nuxt,
  ) => NardukCoreModuleOptions | Promise<NardukCoreModuleOptions>
  setup?: ModuleSetup
}

/**
 * Whether the unwrapped module is about to run `setup()`. Mirrors the two
 * early returns in kit's `normalizedModule`: an install whose unique key is
 * already in `_requiredModules` returns `false`, and an incompatible Nuxt
 * disables the module. The hook must not fire, and no `modules:done` check
 * may register, for an install that will not set up.
 */
async function willSetUp(meta: ModuleMeta | undefined, nuxt: Nuxt): Promise<boolean> {
  const uniqueKey = meta?.name || meta?.configKey
  if (uniqueKey && nuxt.options._requiredModules?.[uniqueKey]) return false
  if (meta?.compatibility && !(await hasNuxtCompatibility(meta.compatibility, nuxt))) return false
  return true
}

function wrapPublishedModule(mod: typeof core): typeof core {
  const resolvable = mod as typeof core & ResolvableModule
  if (typeof resolvable === 'function' && typeof resolvable.getOptions === 'function') {
    const getOptions = resolvable.getOptions.bind(resolvable)
    const getMeta = resolvable.getMeta?.bind(resolvable)
    const wrapped = Object.assign(async function nardukCore(
      inlineOptions: NardukCoreModuleOptions,
      nuxtArg?: Nuxt,
    ) {
      const nuxt = nuxtArg ?? tryUseNuxt() ?? undefined
      // No Nuxt, a duplicate install or an incompatible Nuxt: let the
      // original module take its own early return (or throw) untouched.
      if (!nuxt || !(await willSetUp(await getMeta?.(), nuxt))) {
        return resolvable(inlineOptions, nuxt as Nuxt)
      }
      const contributed = await collectCspContributions(asCspNuxt(nuxt))
      // Resolved only to read the effective `security.headers` shape; these
      // options are discarded, never passed on.
      const effectiveHeaders = (await getOptions(inlineOptions, nuxt)).security?.headers
      return resolvable(
        withCspContributions(
          inlineOptions,
          effectiveHeaders,
          contributed,
        ) as NardukCoreModuleOptions,
        nuxt,
      )
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
