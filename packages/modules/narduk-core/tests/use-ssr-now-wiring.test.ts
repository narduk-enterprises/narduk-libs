import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isReadonly, ref } from 'vue'

import type { Ref } from 'vue'

/**
 * The `#imports` half of `useSsrNow()`: which `useState` key it claims and
 * that the initialiser reads the clock. The lifecycle half — hydration, the
 * switch to the browser clock, ticking and cleanup — is proven with real Vue
 * SSR in use-ssr-now.test.ts.
 */
const stateCalls: Array<{ key: string; value: unknown }> = []

vi.mock('vue', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, onBeforeUnmount: () => {}, onMounted: () => {} }
})

vi.mock('#imports', () => ({
  useState: (key: string, init?: () => unknown) => {
    const value = init?.()
    stateCalls.push({ key, value })
    return ref(value)
  },
}))

beforeEach(() => {
  stateCalls.length = 0
})

describe('useSsrNow wiring', () => {
  it('reads Date.now() once into useState("narduk:now:<key>") and returns it readonly', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_758_196_800_000)
    const { useSsrNow } = await import('../runtime/app/composables/useSsrNow')

    const now: Readonly<Ref<number>> = useSsrNow('map', { tickMs: 60_000 })

    expect(stateCalls).toEqual([{ key: 'narduk:now:map', value: 1_758_196_800_000 }])
    expect(Date.now).toHaveBeenCalledTimes(1)
    expect(now.value).toBe(1_758_196_800_000)
    expect(isReadonly(now)).toBe(true)
  })
})
