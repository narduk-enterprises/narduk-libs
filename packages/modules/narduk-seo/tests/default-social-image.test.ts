import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultSocialMeta } from '../app/utils/defaultSocialMeta'

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

const SITE_URL = 'https://example.com'
const LOGIN_CARD = {
  siteUrl: SITE_URL,
  siteName: 'Example',
  description: 'Public app identity',
  path: '/login',
  image: { url: '/og.png', alt: 'Example app' },
} as const

describe('default social image', () => {
  it('uses an absolute image, canonical page URL, and declared dimensions', () => {
    const meta = defaultSocialMeta(LOGIN_CARD)
    expect(meta).toContainEqual({ property: 'og:image', content: SITE_URL + '/og.png' })
    expect(meta).toContainEqual({ property: 'og:url', content: SITE_URL + '/login' })
    expect(meta).toContainEqual({ property: 'og:image:alt', content: 'Example app' })
    expect(meta).toContainEqual({ property: 'og:image:width', content: '1200' })
    expect(meta).toContainEqual({ property: 'og:image:height', content: '630' })
  })

  // X reads `og:*` when no `twitter:*` tag is present, and Unhead 3 reports every
  // `twitter:*` meta name -- `twitter:card` included -- as deprecated, which turns
  // the shared browser-console contract red on every route (narduk-libs#349).
  it('emits Open Graph only, with no twitter:* meta name', () => {
    const meta = defaultSocialMeta(LOGIN_CARD)
    const names = meta.map((tag) => ('property' in tag ? tag.property : tag.name))
    expect(names.filter((name) => name.toLowerCase().startsWith('twitter:'))).toEqual([])
    expect(names.every((name) => name.startsWith('og:'))).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'https://user:password@example.com/image.png',
    'http://example.com/image.png',
  ])('rejects unsafe image URL %s', (url) => {
    expect(() =>
      defaultSocialMeta({
        siteUrl: SITE_URL,
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
      useSiteConfig: () => ({ url: SITE_URL, name: 'Example', description: 'App' }),
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
      content: SITE_URL + '/account',
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
      useSiteConfig: () => ({ url: SITE_URL, name: 'Example', description: 'App' }),
    }))
    const { default: plugin } = await import('../app/plugins/defaultSocialImage')

    ;(plugin as unknown as () => void)()

    expect(useHead).not.toHaveBeenCalled()
  })

  it.each([
    '//attacker.example',
    '\\attacker.example',
    '/%5cattacker',
    'https://attacker.example/x',
  ])('falls back to the site root instead of poisoning og:url for %s', (path) => {
    expect(() => defaultSocialMeta({ ...LOGIN_CARD, path })).not.toThrow()
    expect(defaultSocialMeta({ ...LOGIN_CARD, path })).toContainEqual({
      property: 'og:url',
      content: `${SITE_URL}/`,
    })
  })

  it('keeps a normal path and query on og:url', () => {
    expect(defaultSocialMeta({ ...LOGIN_CARD, path: '/path?q=1' })).toContainEqual({
      property: 'og:url',
      content: `${SITE_URL}/path?q=1`,
    })
  })

  it('allows an explicit absolute canonical only when it matches the site origin', () => {
    expect(defaultSocialMeta({ ...LOGIN_CARD, path: `${SITE_URL}/narduk-network` })).toContainEqual(
      {
        property: 'og:url',
        content: `${SITE_URL}/narduk-network`,
      },
    )
  })
})
