import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveSeoOgImageDefinition,
  SEO_OG_IMAGE_DEFAULT_PRIMARY,
  SEO_OG_IMAGE_DEFAULT_SECONDARY,
} from '../app/utils/ogImageDefinition'

const BASE = { title: 'Page', description: 'A page', type: 'website' as const }
const APP = { primaryColor: '#062B45', secondaryColor: '#1f7fc4' }

describe('OG card colour precedence (per call, app default, package default)', () => {
  it('uses the package defaults when nothing is set', () => {
    const definition = resolveSeoOgImageDefinition(BASE)

    expect(definition?.props.primaryColor).toBe(SEO_OG_IMAGE_DEFAULT_PRIMARY)
    expect(definition?.props.secondaryColor).toBe(SEO_OG_IMAGE_DEFAULT_SECONDARY)
  })

  it('treats empty app colours as unset', () => {
    const definition = resolveSeoOgImageDefinition({
      ...BASE,
      appColors: { primaryColor: '', secondaryColor: '' },
    })

    expect(definition?.props.primaryColor).toBe(SEO_OG_IMAGE_DEFAULT_PRIMARY)
    expect(definition?.props.secondaryColor).toBe(SEO_OG_IMAGE_DEFAULT_SECONDARY)
  })

  it('uses the app default over the package default, normalized', () => {
    const definition = resolveSeoOgImageDefinition({ ...BASE, appColors: APP })

    expect(definition?.props.primaryColor).toBe('#062b45')
    expect(definition?.props.secondaryColor).toBe('#1f7fc4')
  })

  it('lets a per-call colour win over the app default, one colour at a time', () => {
    const definition = resolveSeoOgImageDefinition({
      ...BASE,
      appColors: APP,
      ogImage: { primaryColor: '#abc' },
    })

    expect(definition?.props.primaryColor).toBe('#aabbcc')
    expect(definition?.props.secondaryColor).toBe('#1f7fc4')
  })

  it('falls through an invalid per-call colour to the app default', () => {
    const definition = resolveSeoOgImageDefinition({
      ...BASE,
      appColors: APP,
      ogImage: { primaryColor: 'not-a-colour' },
    })

    expect(definition?.props.primaryColor).toBe('#062b45')
  })

  it('still emits no card when the page opts out', () => {
    expect(resolveSeoOgImageDefinition({ ...BASE, appColors: APP, ogImage: false })).toBeNull()
  })
})

describe('useSeo passes the app OG colours to the card', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    vi.doUnmock('#imports')
  })

  async function cardProps(
    ogImage: Parameters<typeof resolveSeoOgImageDefinition>[0]['ogImage'],
    colors: unknown,
  ) {
    const defineOgImage = vi.fn()
    vi.doMock('#imports', () => ({
      defineOgImage,
      toValue: (value: unknown) => (typeof value === 'function' ? value() : value),
      useHead: vi.fn(),
      useRoute: () => ({ path: '/map' }),
      useRuntimeConfig: () => ({
        public: {
          appName: 'Example',
          appUrl: 'https://example.com',
          nardukSeoOgImageColors: colors,
        },
      }),
      useSeoMeta: vi.fn(),
      useSiteConfig: () => ({ url: 'https://example.com', name: 'Example' }),
    }))
    const { useSeo } = await import('../app/composables/useSeo')
    useSeo({ title: 'Map', description: 'The map', ogImage })
    return defineOgImage.mock.calls[0]?.[1] as Record<string, unknown> | undefined
  }

  it('applies the app colours, and a per-call colour still wins', async () => {
    const fromApp = await cardProps(undefined, APP)
    expect(fromApp).toMatchObject({ primaryColor: '#062b45', secondaryColor: '#1f7fc4' })

    vi.resetModules()
    const perCall = await cardProps({ primaryColor: '#ff0000' }, APP)
    expect(perCall).toMatchObject({ primaryColor: '#ff0000', secondaryColor: '#1f7fc4' })
  })

  it('keeps the package defaults when the app sets nothing', async () => {
    const props = await cardProps(undefined, undefined)
    expect(props).toMatchObject({
      primaryColor: SEO_OG_IMAGE_DEFAULT_PRIMARY,
      secondaryColor: SEO_OG_IMAGE_DEFAULT_SECONDARY,
    })
  })
})
