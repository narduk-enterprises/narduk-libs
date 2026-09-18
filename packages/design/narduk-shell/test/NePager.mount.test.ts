// @vitest-environment happy-dom
/*
 * NePager, mounted — components backlog item 11 (narduk-libs#258).
 *
 * The real `UPagination` is mounted here, not a stub. A stub would let this
 * file assert its own markup and prove nothing about the two claims that
 * actually matter: that `:to` produces a real `<a href>` a middle-click can
 * open, and that the pager writes back ONLY the page. Nuxt UI's Pagination
 * resolves `to` through vue-router, so a real memory router is installed too;
 * without one it throws inside `useLink`, which is itself the evidence that
 * the anchors below are router-resolved rather than hand-written.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h, type Component } from 'vue'

import NePager from '../src/runtime/components/NePager.vue'

import type { NeCollectionState } from '../src/runtime/composables/use-collection'

const Blank: Component = defineComponent({ setup: () => () => h('div') })

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:pathMatch(.*)*', component: Blank }],
})

/** A reading the pager can render; every case overrides only what it is about. */
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

function render(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(NePager, {
    global: { plugins: [router] },
    props: { state: state(), ...props },
    slots,
  })
}

describe('NePager: the summary says what is on screen', () => {
  it('counts the window and the total when the route counted', () => {
    expect(render({ noun: 'runners' }).get('[data-ne-pager-summary]').text()).toBe(
      '51–75 of 712 runners',
    )
  })

  it('formats grouped counts with pinned en-US, not the host locale', () => {
    const wrapper = render({
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

    expect(wrapper.get('[data-ne-pager-summary]').text()).toBe('1,234–1,234 of 1,234 runners')
  })

  it('reports only the window when the route did not count, inventing no total', () => {
    const wrapper = render({ noun: 'runners', state: state({ pageCount: null, total: null }) })

    expect(wrapper.get('[data-ne-pager-summary]').text()).toBe('51–75 runners')
    expect(wrapper.get('[data-ne-pager-summary]').text()).not.toContain('of')
  })

  it('says "no runners", not "0–0 of 0", for an empty collection', () => {
    const wrapper = render({
      noun: 'runners',
      state: state({ items: [], offset: 0, page: 1, pageCount: 0, total: 0 }),
    })

    expect(wrapper.get('[data-ne-pager-summary]').text()).toBe('No runners')
  })

  it('distinguishes an empty page of a non-empty collection', () => {
    const wrapper = render({ noun: 'runners', state: state({ items: [], total: 712 }) })

    expect(wrapper.get('[data-ne-pager-summary]').text()).toBe('No runners on this page')
  })

  it('marks the summary busy while a request is in flight, and disables nothing', () => {
    const wrapper = render({ state: state({ pending: true }) })

    expect(wrapper.get('[data-ne-pager-summary]').attributes('aria-busy')).toBe('true')
    // Disabling a link is how a pager takes middle-click away for 200ms.
    expect(wrapper.findAll('[disabled]')).toHaveLength(0)
  })

  it('drops the summary entirely when the consumer renders its own', () => {
    const wrapper = render({ showSummary: false })

    expect(wrapper.find('[data-ne-pager-summary]').exists()).toBe(false)
  })

  it('hands the slot the state and the sentence it would have rendered', () => {
    const wrapper = render(
      { noun: 'runners' },
      { summary: '<span class="mine">{{ params.summary }} / {{ params.state.page }}</span>' },
    )

    expect(wrapper.get('.mine').text()).toBe('51–75 of 712 runners / 3')
  })
})

describe('NePager: what it writes back', () => {
  it('emits the new page and nothing else', async () => {
    const wrapper = render()

    await wrapper.get('[aria-label="Pagination"]').findAll('button')[3]!.trigger('click')

    const emitted = wrapper.emitted('update:state')
    expect(emitted).toBeTruthy()
    const next = emitted![0]![0] as NeCollectionState<unknown>
    expect(next.page).not.toBe(3)
    // Everything else is carried through untouched: the pager is not allowed
    // to change `q`, `sort` or `limit` behind useCollection's back.
    expect({ ...next, page: 3 }).toEqual(state())
  })

  it('does not re-emit the page it is already on', async () => {
    const wrapper = render()
    const current = wrapper
      .get('[aria-label="Pagination"]')
      .findAll('button')
      .find((button) => button.attributes('aria-current') === 'page')

    expect(current).toBeTruthy()
    await current!.trigger('click')
    expect(wrapper.emitted('update:state')).toBeUndefined()
  })

  it('pages an uncounted collection with Previous/Next instead of page numbers', async () => {
    const wrapper = render({ state: state({ pageCount: null, total: null }) })

    expect(wrapper.find('[data-ne-pager-previous]').exists()).toBe(true)
    await wrapper.get('[data-ne-pager-next]').trigger('click')

    const next = wrapper.emitted('update:state')![0]![0] as NeCollectionState<unknown>
    expect(next.page).toBe(4)
  })

  it('offers no step past either end of an uncounted collection', () => {
    const first = render({
      state: state({ hasPrevious: false, page: 1, pageCount: null, total: null }),
    })
    const last = render({ state: state({ hasNext: false, pageCount: null, total: null }) })

    expect(first.get('[data-ne-pager-previous]').attributes('disabled')).toBeDefined()
    expect(last.get('[data-ne-pager-next]').attributes('disabled')).toBeDefined()
  })
})

describe('NePager: :to renders real links, because a crawler cannot click', () => {
  it('gives every page control an href a middle-click can open', () => {
    const wrapper = render({ to: (page: number) => ({ path: '/runners', query: { page } }) })

    const hrefs = wrapper
      .findAll('[aria-label="Pagination"] a')
      .map((anchor) => anchor.attributes('href'))

    expect(hrefs.length).toBeGreaterThan(3)
    expect(hrefs).toContain('/runners?page=1')
    expect(hrefs).toContain('/runners?page=29')
    // Router-resolved, not string-concatenated: a bad location would throw.
    for (const href of hrefs) expect(href).toMatch(/^\/runners\?page=\d+$/)
  })

  it('renders buttons, not links, when the consumer gives no :to', () => {
    expect(render().findAll('[aria-label="Pagination"] a')).toHaveLength(0)
  })

  it('links Previous and Next in the uncounted shape too', () => {
    const wrapper = render({
      state: state({ pageCount: null, total: null }),
      to: (page: number) => ({ path: '/runners', query: { page } }),
    })

    expect(wrapper.get('[data-ne-pager-previous]').attributes('href')).toBe('/runners?page=2')
    expect(wrapper.get('[data-ne-pager-next]').attributes('href')).toBe('/runners?page=4')
  })

  it('does not link a step it will not take', () => {
    const wrapper = render({
      state: state({ hasNext: false, pageCount: null, total: null }),
      to: (page: number) => ({ path: '/runners', query: { page } }),
    })

    expect(wrapper.get('[data-ne-pager-next]').attributes('href')).toBeUndefined()
  })
})

describe('NePager: density', () => {
  it('records the density it was asked for so a reviewer can see it', () => {
    expect(
      render({ density: 'dense' }).get('[data-ne-pager]').attributes('data-ne-pager-density'),
    ).toBe('dense')
    expect(render().get('[data-ne-pager]').attributes('data-ne-pager-density')).toBe('default')
  })
})

describe('NePager: page size and "Show more" (narduk-libs#528)', () => {
  const firstPage = (over: Partial<NeCollectionState<unknown>> = {}) =>
    state({ hasPrevious: false, offset: 0, page: 1, pageCount: 11, total: 264, ...over })

  it('offers no page-size select unless page sizes are given', () => {
    expect(render().find('[data-ne-pager-size]').exists()).toBe(false)
  })

  it('renders the select with "N per page" options and the current limit', () => {
    const wrapper = render({ pageSizes: [25, 50, 100], state: firstPage() })
    const select = wrapper.findComponent({ name: 'Select' })
    expect(select.props('modelValue')).toBe(25)
    expect(select.props('items')).toEqual([
      { label: '25 per page', value: 25 },
      { label: '50 per page', value: 50 },
      { label: '100 per page', value: 100 },
    ])
  })

  it('emits update:limit for a new size, and never writes the limit through state', async () => {
    const wrapper = render({ pageSizes: [25, 50, 100], state: firstPage() })
    const select = wrapper.findComponent({ name: 'Select' })
    select.vm.$emit('update:modelValue', 50)
    select.vm.$emit('update:modelValue', 25)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:limit')).toEqual([[50]])
    expect(wrapper.emitted('update:state')).toBeUndefined()
  })

  it('"more" mode replaces the pages with a Show-more button on page one', async () => {
    const wrapper = render({ mode: 'more', noun: 'stations', state: firstPage() })

    expect(wrapper.find('[aria-label="Pagination"]').exists()).toBe(false)
    const more = wrapper.get('[data-ne-pager-more]')
    expect(more.text()).toBe('Show 25 more')
    await more.trigger('click')
    expect(wrapper.emitted('update:limit')).toEqual([[50]])
    expect(wrapper.get('[data-ne-pager-summary]').text()).toBe('1–25 of 264 stations')
  })

  it('keeps saying the first step after the page has grown, and counts down at the end', async () => {
    const wrapper = render({ mode: 'more', state: firstPage() })
    await wrapper.setProps({
      state: firstPage({ items: Array.from({ length: 250 }, (_, id) => ({ id })), limit: 250 }),
    })
    expect(wrapper.get('[data-ne-pager-more]').text()).toBe('Show 14 more')
  })

  it('gives way to numbered pages at maxLimit, off page one, or with nothing more', () => {
    const atCeiling = render({
      maxLimit: 100,
      mode: 'more',
      state: firstPage({ limit: 100, pageCount: 3 }),
    })
    expect(atCeiling.find('[data-ne-pager-more]').exists()).toBe(false)
    expect(atCeiling.find('[aria-label="Pagination"]').exists()).toBe(true)

    expect(render({ mode: 'more' }).find('[data-ne-pager-more]').exists()).toBe(false)
    expect(
      render({ mode: 'more', state: firstPage({ hasNext: false }) })
        .find('[data-ne-pager-more]')
        .exists(),
    ).toBe(false)
  })

  it('clamps a grown limit to maxLimit', async () => {
    const wrapper = render({ maxLimit: 60, mode: 'more', state: firstPage({ limit: 50 }) })
    await wrapper.get('[data-ne-pager-more]').trigger('click')
    expect(wrapper.emitted('update:limit')).toEqual([[60]])
  })

  it('"auto" renders both, split by breakpoint classes, so the server needs no viewport', () => {
    const wrapper = render({ mode: 'auto', state: firstPage() })
    expect(wrapper.get('[data-ne-pager-more]').classes()).toContain('sm:hidden')
    expect(wrapper.get('[aria-label="Pagination"]').classes()).toContain('max-sm:hidden')
  })
})
