/*
 * Server-render proof for NeCardList (narduk-libs#264).
 *
 * Pattern: packages/design/narduk-charts/src/ssr.test.ts. The card grid and
 * the pager summary have to be in the first paint so a toggle between cards
 * and table does not invent rows on hydration. This file runs in vitest's
 * `node` environment and renders through `@vue/server-renderer`.
 *
 * No `:to` here — `test/design-cards.test.ts` and this file have no router,
 * the same constraint `NePager.card.vue` documents. Href proof stays in
 * `test/NePager.ssr.test.ts`.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeCardList from '../src/runtime/components/NeCardList.vue'
import { nuxtUiStubs } from './nuxt-ui-stubs'

import type { NeCollectionState } from '../src/runtime/composables/use-collection'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function state(over: Partial<NeCollectionState<{ name: string }>> = {}): NeCollectionState<{
  name: string
}> {
  return {
    error: null,
    filters: {},
    hasNext: false,
    hasPrevious: false,
    items: [{ name: 'Des Plaines' }, { name: 'Fox' }],
    limit: 25,
    offset: 0,
    page: 1,
    pageCount: 1,
    pending: false,
    q: '',
    sort: null,
    total: 2,
    ...over,
  }
}

function render(
  props: Record<string, unknown> = {},
  card: (slotProps: { item: { name: string } }) => unknown = ({ item }) => h('article', item.name),
): Promise<string> {
  const app = createSSRApp({
    render: () => h(NeCardList, { state: state(), ...props }, { card }),
  })
  for (const [name, component] of Object.entries(nuxtUiStubs)) app.component(name, component)
  return renderToString(app)
}

describe('NeCardList server-rendered without a DOM', () => {
  it('carries each card and the pager summary into the first paint', async () => {
    const html = await render({ noun: 'rivers' })

    expect(html).toContain('data-ne-card-list')
    expect(html).toContain('Des Plaines')
    expect(html).toContain('Fox')
    expect(html).toContain('data-ne-pager')
    expect(html).toContain('1–2 of 2 rivers')
    expect(html).toContain('grid-cols-1')
    expect(html).toContain('md:grid-cols-2')
    expect(html).toContain('xl:grid-cols-3')
  })

  it('carries the empty panel into the first paint when the page is empty', async () => {
    const html = await render({
      emptyTitle: 'No rivers',
      state: state({ items: [], total: 0 }),
    })

    expect(html).toContain('data-ne-state="empty"')
    expect(html).toContain('No rivers')
    expect(html).toContain('data-ne-pager')
    expect(html).not.toContain('Des Plaines')
  })

  it('carries the loading panel into the first paint before any page lands', async () => {
    const html = await render({
      loadingTitle: 'Loading rivers',
      state: state({ items: [], pending: true, total: null }),
    })

    expect(html).toContain('data-ne-state="loading"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Loading rivers')
  })

  it('does not touch a DOM global merely by rendering twice', async () => {
    await expect(render()).resolves.toContain('data-ne-card-list')
    await expect(render({ noun: 'stations' })).resolves.toContain('stations')
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })
})
