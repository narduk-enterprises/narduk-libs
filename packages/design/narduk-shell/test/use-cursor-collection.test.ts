import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useCursorCollection } from '../src/runtime/composables/use-cursor-collection'
import type { CursorListResponse } from '@narduk-enterprises/narduk-platform/list-query'

const page = (id: number, nextCursor: string | null): CursorListResponse<{ id: number }> => ({ items: [{ id }], limit: 1, nextCursor, q: null, sort: null, total: null })

describe('cursor collection', () => {
  it('can retry after a fetch callback throws synchronously', async () => {
    const failure = new Error('unavailable')
    const fetch = vi.fn(() => { if (fetch.mock.calls.length === 1) throw failure; return Promise.resolve(page(1, null)) })
    const scope = effectScope()
    const c = scope.run(() => useCursorCollection({ fetch, immediate: false }))!
    await c.refresh()
    expect(c.error).toBe(failure)
    expect(c.pending).toBe(false)
    await c.refresh()
    expect(c.items).toEqual([{ id: 1 }])
    expect(c.error).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it('traverses bounded pages, preserves exhaustion and revisits without a fabricated total', async () => {
    const fetch = vi.fn(async (query) => query.cursor ? page(1, null) : page(2, 'older'))
    const scope = effectScope()
    const c = scope.run(() => useCursorCollection({ fetch, immediate: false, limit: 1 }))!
    await c.refresh()
    expect(c.items).toEqual([{ id: 2 }])
    expect(c.state.total).toBeNull()
    c.next(); await nextTick(); await c.refresh()
    expect(c.items).toEqual([{ id: 1 }])
    expect(c.state.hasNext).toBe(false)
    c.previous(); await nextTick(); await c.refresh()
    expect(c.items).toEqual([{ id: 2 }])
    expect(c.state.hasPrevious).toBe(false)
    scope.stop()
  })

  it('coalesces scope changes into one follow-up and discards a stale answer', async () => {
    const filters = ref({ group: 'a' })
    const calls: Array<{ query: Record<string, unknown>, signal: AbortSignal, resolve: (page: CursorListResponse<{id:number}>) => void }> = []
    const scope = effectScope()
    const c = scope.run(() => useCursorCollection({ filters, fetch: (query, { signal }) => new Promise<CursorListResponse<{ id: number }>>((resolve) => { calls.push({ query, signal, resolve }) }) }))!
    filters.value = { group: 'b' }; await nextTick()
    filters.value = { group: 'c' }; await nextTick()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.signal.aborted).toBe(true)
    calls[0]!.resolve(page(99, 'stale'))
    await nextTick(); await nextTick()
    expect(c.items).toEqual([])
    expect(calls).toHaveLength(2)
    expect(calls[1]!.query.group).toBe('c')
    calls[1]!.resolve(page(3, null))
    await nextTick(); await nextTick()
    expect(c.items).toEqual([{ id: 3 }])
    scope.stop()
  })

  it('debounces search and leaves navigation intact for an unchanged sort or limit', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async (_query: Record<string, unknown>) => page(2, 'older'))
    const scope = effectScope()
    const c = scope.run(() => useCursorCollection({ fetch, immediate: false, limit: 1 }))!
    await c.refresh()
    c.setLimit(1); c.setSort(null)
    expect(c.state.hasNext).toBe(true)
    c.q = 'h'; await nextTick(); c.q = 'history'; await nextTick()
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(250); await nextTick()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.at(-1)?.[0]).toMatchObject({ q: 'history' })
    scope.stop(); vi.useRealTimers()
  })
})
