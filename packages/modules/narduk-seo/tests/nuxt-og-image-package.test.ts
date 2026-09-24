import { describe, expect, it } from 'vitest'

import {
  canResolveNuxtOgImage,
  isNuxtOgImageModuleRequested,
  isRuntimeOgImageGenerationEnabled,
  isRuntimeOgImageGenerationExplicitlyRequested,
  MISSING_NUXT_OG_IMAGE_MESSAGE,
  NUXT_OG_IMAGE_PACKAGE,
} from '../shared/nuxtOgImagePackage'

describe('nuxt-og-image optional peer (narduk-libs#170)', () => {
  it('treats enabled: false and zeroRuntime as no runtime generation', () => {
    expect(isRuntimeOgImageGenerationEnabled({})).toBe(true)
    expect(isRuntimeOgImageGenerationEnabled({ enabled: true })).toBe(true)
    expect(isRuntimeOgImageGenerationEnabled({ enabled: false })).toBe(false)
    expect(isRuntimeOgImageGenerationEnabled({ zeroRuntime: true })).toBe(false)
  })

  it('treats only an explicit enabled: true as a runtime OG request', () => {
    expect(isRuntimeOgImageGenerationExplicitlyRequested({})).toBe(false)
    expect(isRuntimeOgImageGenerationExplicitlyRequested({ enabled: true })).toBe(true)
    expect(isRuntimeOgImageGenerationExplicitlyRequested({ enabled: false })).toBe(false)
    expect(isRuntimeOgImageGenerationExplicitlyRequested({ zeroRuntime: true })).toBe(false)
    expect(
      isRuntimeOgImageGenerationExplicitlyRequested({ enabled: true, zeroRuntime: true }),
    ).toBe(false)
  })

  it('still requests the module for zeroRuntime build-time cards', () => {
    expect(isNuxtOgImageModuleRequested({})).toBe(true)
    expect(isNuxtOgImageModuleRequested({ enabled: true })).toBe(true)
    expect(isNuxtOgImageModuleRequested({ enabled: false })).toBe(false)
  })

  it('resolves the package in this workspace and reports missing when resolve throws', () => {
    expect(canResolveNuxtOgImage()).toBe(true)
    expect(canResolveNuxtOgImage(() => `${NUXT_OG_IMAGE_PACKAGE}/package.json`)).toBe(true)
    expect(
      canResolveNuxtOgImage(() => {
        throw new Error('Cannot find module')
      }),
    ).toBe(false)
    expect(MISSING_NUXT_OG_IMAGE_MESSAGE).toMatch(/optional nuxt-og-image@6\.8\.0 peer/u)
    expect(MISSING_NUXT_OG_IMAGE_MESSAGE).toMatch(/ogImage\.enabled: false and omit/u)
    expect(MISSING_NUXT_OG_IMAGE_MESSAGE).toMatch(
      /zeroRuntime: true still needs the peer for build-time prerender cards/u,
    )
  })
})
