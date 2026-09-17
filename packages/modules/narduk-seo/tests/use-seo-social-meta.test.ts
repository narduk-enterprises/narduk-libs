import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.doUnmock('#imports')
})

interface SeoMetaPayload extends Record<string, unknown> {
  ogImage?: unknown
  ogImageHeight?: unknown
  ogImageWidth?: unknown
}

async function callUseSeo(
  options: Parameters<typeof import('../app/composables/useSeo').useSeo>[0],
  publicRuntime: Record<string, unknown> = {},
): Promise<SeoMetaPayload> {
  const useSeoMeta = vi.fn()
  const defineOgImage = vi.fn()
  vi.doMock('#imports', () => ({
    defineOgImage,
    toValue: (value: unknown) => (typeof value === 'function' ? value() : value),
    useHead: vi.fn(),
    useRoute: () => ({ path: '/pages/example' }),
    useRuntimeConfig: () => ({
      public: { appUrl: 'https://example.com', appName: 'Example', ...publicRuntime },
    }),
    useSeoMeta,
    useSiteConfig: () => ({ url: 'https://example.com', name: 'Example' }),
  }))
  const { useSeo } = await import('../app/composables/useSeo')
  useSeo(options)
  return (useSeoMeta.mock.calls[0]?.[0] ?? {}) as SeoMetaPayload
}

/**
 * `useSeoMeta` derives every `twitter:*` meta name from a `twitter`-prefixed key, so
 * "no key begins with `twitter`" is the same statement as "the head renders no
 * `twitter:*` meta name" (narduk-libs#349).
 */
function twitterKeys(meta: SeoMetaPayload): string[] {
  return Object.keys(meta).filter((key) => key.toLowerCase().startsWith('twitter'))
}

const BASE = {
  title: 'Example page',
  description: 'An example page',
  image: 'https://example.com/og.png',
} as const

describe('useSeo social metadata', () => {
  it('renders no twitter:* meta and declares the static image dimensions', async () => {
    const meta = await callUseSeo({ ...BASE, ogImage: false })

    expect(twitterKeys(meta)).toEqual([])
    expect(meta.ogImage).toBe('https://example.com/og.png')
    expect(meta.ogImageWidth).toBe('1200')
    expect(meta.ogImageHeight).toBe('630')
  })

  it('accepts caller-declared image dimensions instead of the 1200x630 default', async () => {
    const meta = await callUseSeo({
      ...BASE,
      ogImage: false,
      imageWidth: 800,
      imageHeight: 418,
    })

    expect(meta.ogImageWidth).toBe(800)
    expect(meta.ogImageHeight).toBe(418)
  })

  it('ignores a configured twitterSite handle', async () => {
    const meta = await callUseSeo({ ...BASE, ogImage: false }, { twitterSite: '@narduk' })

    expect(twitterKeys(meta)).toEqual([])
  })

  it('leaves image dimensions to the generated og:image on the dynamic path', async () => {
    const meta = await callUseSeo(BASE)

    expect(twitterKeys(meta)).toEqual([])
    expect(meta).not.toHaveProperty('ogImage')
    expect(meta).not.toHaveProperty('ogImageWidth')
    expect(meta).not.toHaveProperty('ogImageHeight')
  })
})
