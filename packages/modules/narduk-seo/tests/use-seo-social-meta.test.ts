import { afterEach, describe, expect, it, vi } from 'vitest'

import type { useSeo } from '../app/composables/useSeo'

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

interface UseSeoRun {
  canonicalHref: string | undefined
  meta: SeoMetaPayload
}

async function runUseSeo(
  options: Parameters<typeof useSeo>[0],
  extras: { path?: string; publicRuntime?: Record<string, unknown> } = {},
): Promise<UseSeoRun> {
  const useSeoMeta = vi.fn()
  const useHead = vi.fn()
  vi.doMock('#imports', () => ({
    defineOgImage: vi.fn(),
    toValue: (value: unknown) => (typeof value === 'function' ? value() : value),
    useHead,
    useRoute: () => ({ path: extras.path ?? '/pages/example' }),
    useRuntimeConfig: () => ({
      public: { appUrl: 'https://example.com', appName: 'Example', ...extras.publicRuntime },
    }),
    useSeoMeta,
    useSiteConfig: () => ({ url: 'https://example.com', name: 'Example' }),
  }))
  const composables = await import('../app/composables/useSeo')
  composables.useSeo(options)
  const meta = (useSeoMeta.mock.calls[0]?.[0] ?? {}) as SeoMetaPayload
  const head = useHead.mock.calls[0]?.[0] as
    { link?: Array<{ href?: string; rel?: string }> } | undefined
  return {
    canonicalHref: head?.link?.[0]?.href,
    meta,
  }
}

async function callUseSeo(
  options: Parameters<typeof useSeo>[0],
  publicRuntime: Record<string, unknown> = {},
): Promise<SeoMetaPayload> {
  const { meta } = await runUseSeo(options, { publicRuntime })
  return meta
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

describe('useSeo canonical resolution', () => {
  const SITE = 'https://example.com'
  const SAFE_ROOT = `${SITE}/`
  const poisoned = [
    '//attacker.example',
    '\\attacker.example',
    '/%5cattacker',
    'https://attacker.example/x',
  ] as const

  it.each(poisoned)('falls back to the site root when route.path is %s', async (path) => {
    const { canonicalHref, meta } = await runUseSeo({ ...BASE, ogImage: false }, { path })

    expect(meta.ogUrl).toBe(SAFE_ROOT)
    expect(canonicalHref).toBe(SAFE_ROOT)
  })

  it.each(poisoned)('falls back to the site root when canonicalUrl is %s', async (canonicalUrl) => {
    const { canonicalHref, meta } = await runUseSeo({
      ...BASE,
      ogImage: false,
      canonicalUrl,
    })

    expect(meta.ogUrl).toBe(SAFE_ROOT)
    expect(canonicalHref).toBe(SAFE_ROOT)
  })

  it('keeps a normal path and query from the route', async () => {
    const { canonicalHref, meta } = await runUseSeo(
      { ...BASE, ogImage: false },
      { path: '/path?q=1' },
    )

    expect(meta.ogUrl).toBe(`${SITE}/path?q=1`)
    expect(canonicalHref).toBe(`${SITE}/path?q=1`)
  })

  it('keeps a normal path and query from canonicalUrl', async () => {
    const { canonicalHref, meta } = await runUseSeo({
      ...BASE,
      ogImage: false,
      canonicalUrl: '/path?q=1',
    })

    expect(meta.ogUrl).toBe(`${SITE}/path?q=1`)
    expect(canonicalHref).toBe(`${SITE}/path?q=1`)
  })

  it('allows an explicit absolute canonical only when it matches the site origin', async () => {
    const { canonicalHref, meta } = await runUseSeo({
      ...BASE,
      ogImage: false,
      canonicalUrl: `${SITE}/narduk-network`,
    })

    expect(meta.ogUrl).toBe(`${SITE}/narduk-network`)
    expect(canonicalHref).toBe(`${SITE}/narduk-network`)
  })
})
