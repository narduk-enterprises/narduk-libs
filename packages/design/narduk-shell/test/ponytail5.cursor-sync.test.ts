// @vitest-environment happy-dom
/* ponytail-5 repro (shell-src #3, shell-tests #1): cursor collection route watcher. */
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, type Component } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { CursorListResponse } from '@narduk-enterprises/narduk-platform/list-query'
import { useCursorCollection } from '../src/runtime/composables/use-cursor-collection'

const page = (id: number, nextCursor: string | null): CursorListResponse<{ id: number }> => ({ items: [{ id }], limit: 1, nextCursor, q: null, sort: null, total: null })
async function settle() { for (let i = 0; i < 4; i++) { await flushPromises(); await nextTick() } }

async function mountCursor(options: Record<string, unknown>, url: string) {
  const Blank: Component = defineComponent({ setup: () => () => h('div') })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: Blank }] })
  await router.push(url)
  await router.isReady()
  let c!: ReturnType<typeof useCursorCollection>
  const w = mount(defineComponent({ setup() { c = useCursorCollection(options as never); return () => h('div') } }), { global: { plugins: [router] } })
  await settle()
  return { c, router, unmount: () => w.unmount() }
}

describe('ponytail-5 cursor route sync', () => {
  it('shell-src #3: setSort(null) sticks when a default sort option exists', async () => {
    const fetch = vi.fn(async () => page(1, 'n1'))
    const { c, router, unmount } = await mountCursor({ syncQuery: true, sort: 'created:desc', fetch, limit: 1 }, '/x')
    await settle()
    c.next(); await settle()
    expect(router.currentRoute.value.query.sort).toBe('created:desc')
    c.setSort(null); await settle()
    expect(c.sort).toBeNull()
    unmount()
  })

  it('keeps the default sort and cursor when an unrelated query param changes', async () => {
    const fetch = vi.fn(async () => page(1, 'n1'))
    const { c, router, unmount } = await mountCursor({ syncQuery: true, sort: 'created:desc', fetch, limit: 1 }, '/x')
    await router.push('/x?foo=1')
    await settle()
    expect(c.sort).toBe('created:desc')
    unmount()
  })

  it('keeps the cursor when an unrelated param changes under a default sort', async () => {
    const fetch = vi.fn(async () => page(1, 'n1'))
    const { c, router, unmount } = await mountCursor({ syncQuery: true, sort: 'created:desc', fetch, limit: 1 }, '/x?cursor=abc')
    await router.push('/x?cursor=abc&foo=1')
    await settle()
    expect(c.sort).toBe('created:desc')
    expect(c.state.cursor).toBe('abc')
    unmount()
  })

  it('shell-tests #1: Back to ?q=river&cursor=abc keeps the cursor', async () => {
    const fetch = vi.fn(async () => page(1, null))
    const { c, router, unmount } = await mountCursor({ syncQuery: true, fetch, limit: 1, debounce: 0 }, '/x?q=lake')
    await router.push('/x?q=river&cursor=abc')
    await settle()
    expect(c.state.cursor).toBe('abc')
    expect(router.currentRoute.value.query.cursor).toBe('abc')
    unmount()
  })
})
