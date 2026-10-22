import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildPageTitle, PAGE_TITLE_SEPARATOR } from '../app/utils/pageTitle'

import type { PageSeoOptions } from '../app/composables/usePageSeo'

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.doUnmock('#imports')
})

describe('buildPageTitle', () => {
  it('joins the page and the site with the house separator', () => {
    expect(PAGE_TITLE_SEPARATOR).toBe('·')
    expect(buildPageTitle('Trades', { siteName: 'Stonx' })).toBe('Trades · Stonx')
  })

  it('accepts another separator, and ignores a blank one', () => {
    expect(buildPageTitle('Trades', { siteName: 'Stonx', separator: '|' })).toBe('Trades | Stonx')
    expect(buildPageTitle('Trades', { siteName: 'Stonx', separator: '  ' })).toBe('Trades · Stonx')
  })

  it('is the site name alone when there is no page title', () => {
    expect(buildPageTitle(undefined, { siteName: 'Stonx' })).toBe('Stonx')
    expect(buildPageTitle('', { siteName: 'Stonx' })).toBe('Stonx')
    expect(buildPageTitle('   ', { siteName: 'Stonx' })).toBe('Stonx')
    expect(buildPageTitle(null, { siteName: 'Stonx' })).toBe('Stonx')
  })

  it('does not repeat a site name the title already carries', () => {
    expect(buildPageTitle('Stonx', { siteName: 'Stonx' })).toBe('Stonx')
    expect(buildPageTitle('Stonx rules', { siteName: 'Stonx' })).toBe('Stonx rules')
    expect(buildPageTitle('Rules of STONX', { siteName: 'Stonx' })).toBe('Rules of STONX')
  })

  it('is the page title alone when no site name is configured', () => {
    expect(buildPageTitle('Trades')).toBe('Trades')
    expect(buildPageTitle('Trades', { siteName: '  ' })).toBe('Trades')
    expect(buildPageTitle(undefined)).toBe('')
  })

  it('trims both parts', () => {
    expect(buildPageTitle('  Trades ', { siteName: ' Stonx ' })).toBe('Trades · Stonx')
  })
})

interface HeadInput {
  titleTemplate?: (title?: string) => string | null
}

async function runUsePageSeo(options: PageSeoOptions, siteName: string | undefined = 'Stonx') {
  const useSeoMeta = vi.fn()
  const useHead = vi.fn()
  vi.doMock('#imports', () => ({
    defineOgImage: vi.fn(),
    toValue: (value: unknown) => (typeof value === 'function' ? value() : value),
    useHead,
    useRoute: () => ({ path: '/trades' }),
    useRuntimeConfig: () => ({ public: { appUrl: 'https://example.com', appName: 'Fallback' } }),
    useSeoMeta,
    useSiteConfig: () => ({ url: 'https://example.com', name: siteName }),
  }))
  const { usePageSeo } = await import('../app/composables/usePageSeo')
  usePageSeo(options)
  const heads = useHead.mock.calls.map((call) => call[0] as HeadInput)
  return {
    meta: (useSeoMeta.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>,
    template: heads.find((head) => head.titleTemplate)?.titleTemplate,
  }
}

const BASE = { title: 'Trades', description: 'Every fill in this game.', ogImage: false } as const

describe('usePageSeo', () => {
  it('suffixes the browser title with the site name', async () => {
    const { template } = await runUsePageSeo(BASE)

    expect(template?.('Trades')).toBe('Trades · Stonx')
  })

  it('leaves og:title as the page title and passes the rest through to useSeo', async () => {
    const { meta } = await runUsePageSeo(BASE)

    expect(meta.title).toBeTypeOf('function')
    expect((meta.title as () => string)()).toBe('Trades')
    expect((meta.ogTitle as () => string)()).toBe('Trades')
    expect((meta.description as () => string)()).toBe('Every fill in this game.')
    expect(meta.ogUrl).toBe('https://example.com/trades')
  })

  it('follows a title that changes, since the template receives the current one', async () => {
    const { template } = await runUsePageSeo(BASE)

    expect(template?.('Orders')).toBe('Orders · Stonx')
    expect(template?.()).toBe('Stonx')
  })

  it('honours a custom separator', async () => {
    const { template } = await runUsePageSeo({ ...BASE, titleSeparator: '|' })

    expect(template?.('Trades')).toBe('Trades | Stonx')
  })

  it('adds no template when titleSuffix is false', async () => {
    const { template, meta } = await runUsePageSeo({ ...BASE, titleSuffix: false })

    expect(template).toBeUndefined()
    expect((meta.title as () => string)()).toBe('Trades')
  })

  it('falls back to runtimeConfig.public.appName when the site config has no name', async () => {
    const { template } = await runUsePageSeo(BASE, '')

    expect(template?.('Trades')).toBe('Trades · Fallback')
  })

  it('does not forward its own options to useSeo', async () => {
    const { meta } = await runUsePageSeo({ ...BASE, titleSeparator: '|' })

    expect(meta).not.toHaveProperty('titleSeparator')
    expect(meta).not.toHaveProperty('titleSuffix')
  })
})
