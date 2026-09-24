import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isReadonly, ref } from 'vue'

/**
 * The `#imports` half of `useLiveProduct()`: that its label reads the
 * render-safe clock under the key it claims (narduk-libs#374). Polling,
 * visibility, coalescing and hydration are proven in use-live-product.test.ts.
 */
const stateKeys: string[] = []

vi.mock('vue', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, onBeforeUnmount: () => {}, onMounted: () => {} }
})

vi.mock('#imports', () => ({
  useState: (key: string, init?: () => unknown) => {
    stateKeys.push(key)
    return ref(init?.())
  },
}))

beforeEach(() => {
  stateKeys.length = 0
})

describe('useLiveProduct wiring', () => {
  it('reads useSsrNow under narduk:now:live-product unless given a clockKey', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_758_628_800_000)
    const { useLiveProduct } = await import('../runtime/app/composables/useLiveProduct')

    const live = useLiveProduct(async () => {}, {
      intervalMs: 60_000,
      updatedAt: 1_758_628_800_000 - 120_000,
    })
    useLiveProduct(async () => {}, { clockKey: 'buoys', intervalMs: 60_000 })

    expect(stateKeys).toEqual(['narduk:now:live-product', 'narduk:now:buoys'])
    expect(live.updatedAgo.value).toBe('2 minutes ago')
    expect(isReadonly(live.pending)).toBe(true)
    expect(typeof live.refresh).toBe('function')
  })
})
