// @vitest-environment happy-dom
/*
 * NeCardList, mounted (narduk-libs#264): the card reading of the same
 * collection state the table draws. NeStatePanel and NePager are built in.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h, reactive, type Component, type VNode } from 'vue'

import { type NeCardListProps, type NeCollection, type NeCollectionState } from '../src/index'
import NeCardList from '../src/runtime/components/NeCardList.vue'
import { nuxtUiStubs } from './nuxt-ui-stubs'

const Blank: Component = defineComponent({ setup: () => () => h('div') })

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:pathMatch(.*)*', component: Blank }],
})

const RiverCard = defineComponent({
  name: 'RiverCard',
  props: { item: { required: true, type: Object } },
  setup(props) {
    return () => h('article', { 'data-river-card': props.item.id }, props.item.name)
  },
})

function state(over: Partial<NeCollectionState<{ id: string; name: string }>> = {}) {
  return {
    error: null,
    filters: {},
    hasNext: false,
    hasPrevious: false,
    items: [
      { id: 'des-plaines', name: 'Des Plaines' },
      { id: 'fox', name: 'Fox' },
    ],
    limit: 25,
    offset: 0,
    page: 1,
    pageCount: 1,
    pending: false,
    q: '',
    sort: null,
    total: 2,
    ...over,
  } satisfies NeCollectionState<{ id: string; name: string }>
}

function render(
  props: Partial<NeCardListProps<{ id: string; name: string }>> & {
    state?: NeCollectionState<{ id: string; name: string }>
  } = {},
  slots: Record<string, string | ((slotProps: { item: { name: string } }) => VNode)> = {},
) {
  return mount(NeCardList, {
    global: { components: nuxtUiStubs, plugins: [router] },
    props: { state: state(), ...props },
    slots,
  })
}

describe('NeCardList: the same collection the table draws', () => {
  it('renders one card per item through the card slot', () => {
    const wrapper = render({}, { card: ({ item }) => h('article', item.name) })
    expect(wrapper.find('[data-ne-card-list]').exists()).toBe(true)
    expect(wrapper.findAll('[data-ne-card-list] li')).toHaveLength(2)
    expect(wrapper.text()).toContain('Des Plaines')
    expect(wrapper.text()).toContain('Fox')
  })

  it("renders :card as the per-item component, the plan's RiverCard form", () => {
    const wrapper = render({ card: RiverCard })
    expect(wrapper.get('[data-river-card="des-plaines"]').text()).toBe('Des Plaines')
    expect(wrapper.get('[data-river-card="fox"]').text()).toBe('Fox')
  })

  it('applies the plan default grid: one column, two from md, three from xl', () => {
    const wrapper = render()
    const grid = wrapper.get('.ne-card-list__grid')
    expect(grid.classes()).toContain('grid-cols-1')
    expect(grid.classes()).toContain('md:grid-cols-2')
    expect(grid.classes()).toContain('xl:grid-cols-3')
  })

  it('picks only the breakpoints the caller named, as literal utilities', () => {
    const wrapper = render({ columns: { base: 2, lg: 4 } })
    const classes = wrapper.get('.ne-card-list__grid').classes()
    expect(classes).toContain('grid-cols-2')
    expect(classes).toContain('lg:grid-cols-4')
    expect(classes).not.toContain('md:grid-cols-2')
  })

  it('shows the empty panel when the page landed with no rows', () => {
    const wrapper = render({
      emptyMessage: 'No rivers match.',
      emptyTitle: 'No rivers',
      state: state({ items: [], pageCount: 1, total: 0 }),
    })
    expect(wrapper.get('[data-ne-state="empty"]').text()).toContain('No rivers')
    expect(wrapper.find('.ne-card-list__grid').exists()).toBe(false)
  })

  it('shows the loading panel only when nothing has landed yet', () => {
    const wrapper = render({
      loadingTitle: 'Loading rivers',
      state: state({ items: [], pending: true, total: null }),
    })
    expect(wrapper.get('[data-ne-state="loading"]').attributes('aria-busy')).toBe('true')
    expect(wrapper.find('.ne-card-list__grid').exists()).toBe(false)
  })

  it('keeps the last good page on screen while a later request is in flight', () => {
    const wrapper = render({
      state: state({ pending: true }),
    })
    expect(wrapper.find('[data-ne-state]').exists()).toBe(false)
    expect(wrapper.findAll('[data-ne-card-list] li')).toHaveLength(2)
    expect(wrapper.get('[data-ne-pager-summary]').attributes('aria-busy')).toBe('true')
  })

  it('shows the error panel when the first request failed', () => {
    const wrapper = render({
      errorMessage: 'The list could not be loaded.',
      errorTitle: 'Rivers unavailable',
      state: state({ error: new Error('boom'), items: [], total: null }),
    })
    expect(wrapper.get('[data-ne-state="error"]').text()).toContain('Rivers unavailable')
  })

  it('writes only the page back through v-model:state', async () => {
    const wrapper = render({
      state: state({
        hasNext: true,
        hasPrevious: false,
        items: Array.from({ length: 25 }, (_, index) => ({ id: String(index), name: `R${index}` })),
        pageCount: null,
        total: null,
      }),
    })
    await wrapper.get('[data-ne-pager-next]').trigger('click')
    const emitted = wrapper.emitted('update:state')
    expect(emitted).toBeDefined()
    expect((emitted?.[0]?.[0] as NeCollectionState<unknown>).page).toBe(2)
  })

  it('forwards update:limit to collection.setLimit when :collection is bound', async () => {
    const collection = reactive({
      setLimit: (limit: number) => {
        collection.state = { ...collection.state, limit, page: 1 }
      },
      state: state({
        hasNext: true,
        items: Array.from({ length: 25 }, (_, index) => ({ id: String(index), name: `R${index}` })),
        page: 1,
        pageCount: 3,
        total: 60,
      }),
    }) as NeCollection<{ id: string; name: string }>
    const wrapper = mount(NeCardList, {
      global: { components: nuxtUiStubs, plugins: [router] },
      props: {
        collection,
        maxLimit: 100,
        mode: 'more',
        noun: 'rivers',
      },
    })
    await wrapper.get('[data-ne-pager-more]').trigger('click')
    expect(collection.state.limit).toBe(50)
    expect(collection.state.page).toBe(1)
  })
})
