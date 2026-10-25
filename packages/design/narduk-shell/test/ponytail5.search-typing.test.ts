// @vitest-environment happy-dom
/* ponytail-5 repro (shell-src #2): a page change inside the debounce window wipes typed search. */
import { expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, type Component } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useCollection, type NeCollection } from '../src/runtime/composables/use-collection'

async function settle() { for (let i = 0; i < 4; i++) { await flushPromises(); await nextTick() } }

it('keeps the typed search when the page changes before the debounce fires', async () => {
  const fetch = vi.fn(async () => ({ items: [], limit: 10, offset: 0, q: null, sort: null, total: 500 }))
  const Blank: Component = defineComponent({ setup: () => () => h('div') })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: Blank }] })
  await router.push('/x'); await router.isReady()
  let c!: NeCollection<unknown>
  mount(defineComponent({ setup() { c = useCollection({ fetch, limit: 10, debounce: 100, syncQuery: true } as never) as never; return () => h('div') } }), { global: { plugins: [router] } })
  await settle()
  c.q = 'hello'
  c.setPage(2)
  await settle()
  expect(c.q).toBe('hello')
  await new Promise((r) => setTimeout(r, 200))
  await settle()
  expect(c.state.q).toBe('hello')
})
