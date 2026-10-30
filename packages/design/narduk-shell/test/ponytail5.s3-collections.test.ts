/* ponytail-5 s3-shell: cursor and offset collection edges. */
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { useCollection } from '../src/runtime/composables/use-collection'
import { useCursorCollection } from '../src/runtime/composables/use-cursor-collection'

import type {
  CursorListResponse,
  OffsetListResponse,
} from '@narduk-enterprises/narduk-platform/list-query'

const page = (id: number, nextCursor: string | null): CursorListResponse<{ id: number }> => ({
  items: [{ id }],
  limit: 1,
  nextCursor,
  q: null,
  sort: null,
  total: null,
})

describe('useCursorCollection: reserved filter keys (shell-src #7, shell-tests #2)', () => {
  it.each(['cursor', 'limit', 'offset', 'q', 'sort'])(
    'refuses a "%s" filter before any fetch',
    (key) => {
      const fetch = vi.fn(async () => page(1, null))
      const scope = effectScope()
      expect(() =>
        scope.run(() => useCursorCollection({ fetch, filters: { [key]: 'x' }, immediate: false })),
      ).toThrow(TypeError)
      expect(fetch).not.toHaveBeenCalled()
      scope.stop()
    },
  )
})

describe('useCursorCollection: aborts and the initial sort', () => {
  it('does not show an aborted request that rejects as the error (shell-tests #3)', async () => {
    const enabled = ref(true)
    const rejects: Array<(reason: unknown) => void> = []
    const fetch = vi.fn(
      () =>
        new Promise<CursorListResponse<{ id: number }>>((_resolve, reject) => rejects.push(reject)),
    )
    const scope = effectScope()
    const c = scope.run(() => useCursorCollection({ fetch, enabled }))!
    await nextTick()
    await nextTick()
    expect(fetch).toHaveBeenCalledTimes(1)
    enabled.value = false
    await nextTick()
    rejects[0]!(new DOMException('aborted', 'AbortError'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(c.error).toBeNull()
    scope.stop()
  })

  it('drops an initial sort outside the allowlist before the first request (shell-tests #13)', async () => {
    const fetch = vi.fn(async (_query: Record<string, unknown>) => page(1, null))
    const scope = effectScope()
    const c = scope.run(() =>
      useCursorCollection({ fetch, immediate: false, sort: 'secret:asc', sortable: ['name'] }),
    )!
    await c.refresh()
    expect(fetch.mock.calls[0]![0]).not.toHaveProperty('sort')
    const bad = scope.run(() =>
      useCursorCollection({ fetch, immediate: false, sort: 'name:sideways' }),
    )!
    await bad.refresh()
    expect(fetch.mock.calls[1]![0]).not.toHaveProperty('sort')
    scope.stop()
  })
})

describe('useCollection: disposal (shell-tests #15)', () => {
  it('does not start another fetch when the aborted one rejects after the scope ends', async () => {
    const scope = effectScope()
    const fetch = vi.fn(
      (_query: unknown, { signal }: { signal: AbortSignal }) =>
        new Promise<OffsetListResponse<{ id: number }>>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    scope.run(() => useCollection({ fetch }))
    await nextTick()
    await nextTick()
    expect(fetch).toHaveBeenCalledTimes(1)
    scope.stop()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
