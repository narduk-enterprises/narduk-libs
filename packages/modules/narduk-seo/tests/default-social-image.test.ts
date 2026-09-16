import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultSocialMeta } from '../app/utils/defaultSocialMeta'

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('default social image', () => {
  it('uses an absolute image, canonical page URL, dimensions, and both card formats', () => {
    const meta = defaultSocialMeta({
      siteUrl: 'https://example.com',
      siteName: 'Example',
      description: 'Public app identity',
      path: '/login',
      image: { url: '/og.png', alt: 'Example app' },
    })
    expect(meta).toContainEqual({ property: 'og:image', content: 'https://example.com/og.png' })
    expect(meta).toContainEqual({ property: 'og:url', content: 'https://example.com/login' })
    expect(meta).toContainEqual({ property: 'og:image:width', content: '1200' })
    expect(meta).toContainEqual({ name: 'twitter:card', content: 'summary_large_image' })
    expect(meta).toContainEqual({ name: 'twitter:image', content: 'https://example.com/og.png' })
  })

  it.each([
    'javascript:alert(1)',
    'https://user:password@example.com/image.png',
    'http://example.com/image.png',
  ])('rejects unsafe image URL %s', (url) => {
    expect(() =>
      defaultSocialMeta({
        siteUrl: 'https://example.com',
        siteName: 'Example',
        description: 'App',
        path: '/',
        image: { url, alt: 'Example' },
      }),
    ).toThrow(/HTTPS/u)
  })

  it('registers defaults below page overrides and updates the URL on navigation', async () => {
    const route = { path: '/' }
    const useHead = vi.fn()
    vi.doMock('#imports', () => ({
      defineNuxtPlugin: <T>(plugin: T): T => plugin,
      useHead,
      useRoute: () => route,
      useRuntimeConfig: () => ({
        public: { nardukSeoDefaultImage: { url: '/og.png', alt: 'Example' } },
      }),
      useSiteConfig: () => ({ url: 'https://example.com', name: 'Example', description: 'App' }),
    }))
    const { default: plugin } = await import('../app/plugins/defaultSocialImage')
    ;(plugin as unknown as () => void)()
    expect(useHead).toHaveBeenCalledWith(expect.any(Function), { tagPriority: 'low' })
    const metadata = useHead.mock.calls[0]?.[0] as () => {
      meta: ReturnType<typeof defaultSocialMeta>
    }
    route.path = '/account'
    expect(metadata().meta).toContainEqual({
      property: 'og:url',
      content: 'https://example.com/account',
    })
  })

  it('skips malformed runtime config image values', async () => {
    const useHead = vi.fn()
    vi.doMock('#imports', () => ({
      defineNuxtPlugin: <T>(plugin: T): T => plugin,
      useHead,
      useRoute: () => ({ path: '/' }),
      useRuntimeConfig: () => ({
        public: { nardukSeoDefaultImage: { url: '/og.png' } },
      }),
      useSiteConfig: () => ({ url: 'https://example.com', name: 'Example', description: 'App' }),
    }))
    const { default: plugin } = await import('../app/plugins/defaultSocialImage')

    ;(plugin as unknown as () => void)()

    expect(useHead).not.toHaveBeenCalled()
  })
})
