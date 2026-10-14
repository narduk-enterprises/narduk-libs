/*
 * useRowLimit: the first `n` rows, then all of them on request. No component
 * and no DOM, so this runs in the default node environment.
 */
import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'

import { useRowLimit } from '../src/runtime/composables/use-row-limit'

const ROWS = Array.from({ length: 12 }, (_, index) => ({ id: index + 1 }))

describe('useRowLimit', () => {
  it('shows the first n rows in the list order and counts what it cut', () => {
    const limit = useRowLimit(ROWS, 5)

    expect(limit.visible.value.map((row) => row.id)).toEqual([1, 2, 3, 4, 5])
    expect(limit.total.value).toBe(12)
    expect(limit.hidden.value).toBe(7)
    expect(limit.showAll.value).toBe(false)
  })

  it('shows everything on expand, and caps again on collapse', () => {
    const limit = useRowLimit(ROWS, 5)

    limit.expand()
    expect(limit.showAll.value).toBe(true)
    expect(limit.visible.value).toHaveLength(12)
    expect(limit.hidden.value).toBe(0)

    limit.collapse()
    expect(limit.visible.value).toHaveLength(5)
    expect(limit.hidden.value).toBe(7)
  })

  it('hides nothing when the list fits', () => {
    const limit = useRowLimit(ROWS.slice(0, 3), 5)
    expect(limit.visible.value).toHaveLength(3)
    expect(limit.hidden.value).toBe(0)
  })

  it('follows a ref list and a getter n (a viewport-sized cap)', async () => {
    const rows = ref(ROWS.slice(0, 4))
    const cap = ref(2)
    const limit = useRowLimit(rows, () => cap.value)

    expect(limit.hidden.value).toBe(2)
    cap.value = 3
    await nextTick()
    expect(limit.visible.value).toHaveLength(3)
    rows.value = ROWS
    await nextTick()
    expect(limit.total.value).toBe(12)
    expect(limit.hidden.value).toBe(9)
  })

  it('stays expanded when the list changes', async () => {
    const rows = ref(ROWS.slice(0, 6))
    const limit = useRowLimit(rows, 2)
    limit.expand()
    rows.value = ROWS
    await nextTick()
    expect(limit.visible.value).toHaveLength(12)
  })

  it('floors a fractional cap, and treats a negative cap as zero rows', () => {
    expect(useRowLimit(ROWS, 2.9).visible.value).toHaveLength(2)
    expect(useRowLimit(ROWS, -4).visible.value).toHaveLength(0)
    expect(useRowLimit(ROWS, -4).hidden.value).toBe(12)
  })

  it('applies no cap for a NaN n instead of hiding the whole list', () => {
    expect(useRowLimit(ROWS, Number.NaN).visible.value).toHaveLength(12)
  })
})
