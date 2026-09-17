/*
 * Server-render proof for NePager — the plan's standard done-when 2, and the
 * only place the item's SEO claim can actually be tested.
 *
 * riverstatus's rivers list is the pilot: page two has to be a URL a crawler
 * can follow before any JavaScript runs. That is a claim about the SERVER's
 * first paint, so asserting it in the mount suite would prove the wrong thing
 * — happy-dom has already hydrated by then. This file therefore runs in the
 * config's default `node` environment (it deliberately carries no
 * `@vitest-environment` directive), renders through `@vue/server-renderer`,
 * and asserts the `href` attributes in the string that comes back.
 *
 * The real `UPagination` is rendered, not a stub. A stub emitting its own
 * `<a href>` would pass this file while the shipped component emitted
 * `<button>`, which is exactly the bug the pilot cares about.
 *
 * Pattern: packages/design/narduk-charts/src/ssr.test.ts.
 */
import { renderToString } from '@vue/server-renderer'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp, defineComponent, h, type Component } from 'vue'

import NePager from '../src/runtime/components/NePager.vue'

const numberFormatLocales: unknown[] = []
const OriginalNumberFormat = Intl.NumberFormat

beforeAll(() => {
  function TrackingNumberFormat(locale?: string | string[], options?: Intl.NumberFormatOptions) {
    numberFormatLocales.push(locale)
    return new OriginalNumberFormat(locale, options)
  }
  vi.spyOn(Intl, 'NumberFormat').mockImplementation(
    TrackingNumberFormat as unknown as typeof Intl.NumberFormat,
  )
})

afterAll(() => {
  vi.restoreAllMocks()
})

import type { NeCollectionState } from '../src/runtime/composables/use-collection'

/** The globals a Workers-style server runtime does not have. */
it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

const Blank: Component = defineComponent({ setup: () => () => h('div') })

function state(over: Partial<NeCollectionState<unknown>> = {}): NeCollectionState<unknown> {
  return {
    error: null,
    filters: {},
    hasNext: true,
    hasPrevious: true,
    items: Array.from({ length: 25 }, (_, index) => ({ id: index })),
    limit: 25,
    offset: 50,
    page: 3,
    pageCount: 29,
    pending: false,
    q: '',
    sort: null,
    total: 712,
    ...over,
  }
}

/**
 * Renders the pager the way a server does: a fresh app per render, a router
 * that has resolved the current URL, and no DOM anywhere.
 */
async function renderPager(props: Record<string, unknown> = {}): Promise<string> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: Blank }],
  })
  await router.push('/runners?page=3')
  await router.isReady()

  const app = createSSRApp({
    render: () => h(NePager, { state: state(), ...props }),
  })
  app.use(router)
  return renderToString(app)
}

describe('NePager server-rendered without a DOM', () => {
  it('renders the pager and its summary into the first paint', async () => {
    const html = await renderPager({ noun: 'runners' })

    expect(html).toContain('data-ne-pager')
    expect(html).toContain('51–75 of 712 runners')
    expect(html).toContain('aria-label="Pagination"')
  })

  it('formats grouped counts with pinned en-US in the server output', async () => {
    const html = await renderPager({
      noun: 'runners',
      state: state({
        items: [{ id: 1 }],
        limit: 25,
        offset: 1233,
        page: 50,
        pageCount: 50,
        total: 1234,
      }),
    })

    expect(html).toContain('1,234–1,234 of 1,234 runners')
    expect(numberFormatLocales).toContain('en-US')
  })

  it('emits real hrefs for :to, so a crawler reaches page two without running JS', async () => {
    const html = await renderPager({
      to: (page: number) => ({ path: '/runners', query: { page } }),
    })

    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
    // Every numbered control is an anchor, and the anchors are the pages.
    expect(hrefs).toContain('/runners?page=1')
    expect(hrefs).toContain('/runners?page=2')
    expect(hrefs).toContain('/runners?page=29')
    expect(hrefs.length).toBeGreaterThan(3)
  })

  it('renders buttons, and no hrefs at all, when the consumer gives no :to', async () => {
    const html = await renderPager()

    expect(html).not.toContain('href=')
    expect(html).toContain('<button')
  })

  it('server-renders the uncounted shape as two real links', async () => {
    const html = await renderPager({
      state: state({ pageCount: null, total: null }),
      to: (page: number) => ({ path: '/runners', query: { page } }),
    })

    expect(html).toContain('data-ne-pager-previous')
    expect(html).toContain('data-ne-pager-next')
    expect(html).toContain('href="/runners?page=2"')
    expect(html).toContain('href="/runners?page=4"')
    // No page numbers: the route did not count, so there is no page 29 to link.
    expect(html).not.toContain('/runners?page=29')
  })

  it('does not link a step past the end, even on the server', async () => {
    const html = await renderPager({
      state: state({ hasNext: false, pageCount: null, total: null }),
      to: (page: number) => ({ path: '/runners', query: { page } }),
    })

    expect(html).toContain('href="/runners?page=2"')
    expect(html).not.toContain('href="/runners?page=4"')
  })

  it('carries the polite summary region into the first paint, busy and not', async () => {
    expect(await renderPager()).toContain('aria-live="polite"')
    expect(await renderPager({ state: state({ pending: true }) })).toContain('aria-busy="true"')
    expect(await renderPager()).not.toContain('aria-busy')
  })

  it('server-renders the empty reading rather than 0–0 of 0', async () => {
    const html = await renderPager({
      noun: 'runners',
      state: state({ items: [], offset: 0, page: 1, pageCount: 0, total: 0 }),
    })

    expect(html).toContain('No runners')
    expect(html).not.toContain('0–0')
  })

  it('does not touch a DOM global merely by rendering twice', async () => {
    await expect(renderPager()).resolves.toContain('data-ne-pager')
    await expect(renderPager({ density: 'dense' })).resolves.toContain(
      'data-ne-pager-density="dense"',
    )
  })
})
