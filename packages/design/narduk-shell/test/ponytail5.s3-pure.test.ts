/* ponytail-5 s3-shell: formatRelative months, an undefined row cap, a Date cell, the client sort locale. */
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { formatRelative } from '../src/format'
import { sortRows } from '../src/runtime/utils/collection-engine'
import { useRowLimit } from '../src/runtime/composables/use-row-limit'

const zone = { locale: 'en-US', timeZone: 'UTC' }

describe('formatRelative: month arithmetic', () => {
  it('does not call 30 days "this month" (shell-src #4)', () => {
    const now = '2026-03-08T12:00:00Z'
    expect(formatRelative('2026-04-07T12:00:00Z', { ...zone, now })).toBe('in 4 weeks')
    expect(formatRelative('2026-04-07T12:00:00Z', { ...zone, now, numeric: 'always' })).toBe(
      'in 4 weeks',
    )
    expect(formatRelative('2026-03-31T12:00:00Z', { ...zone, now: '2026-04-30T12:00:00Z' })).toBe(
      '4 weeks ago',
    )
  })

  it('takes a month off when the end day comes earlier, and adds one back in reverse (shell-tests #17)', () => {
    expect(formatRelative('2026-03-30T12:00:00Z', { ...zone, now: '2026-01-31T12:00:00Z' })).toBe(
      'next month',
    )
    expect(formatRelative('2026-01-31T12:00:00Z', { ...zone, now: '2026-03-30T12:00:00Z' })).toBe(
      'last month',
    )
  })
})

describe('useRowLimit: a missing cap (shell-src #6)', () => {
  const rows = Array.from({ length: 12 }, (_, id) => ({ id }))

  it('applies no cap while n is undefined, and keeps a negative n at zero rows', () => {
    const missing = ref<number | undefined>()
    const limit = useRowLimit(rows, missing as unknown as number)
    expect(limit.visible.value).toHaveLength(12)
    expect(limit.hidden.value).toBe(0)
    missing.value = -3
    expect(limit.visible.value).toHaveLength(0)
  })
})

describe('sortRows: the host locale cannot reorder text (shell-tests #5)', () => {
  it('compares with a fixed locale, not the process default', () => {
    const spy = vi.spyOn(String.prototype, 'localeCompare')
    try {
      const rows = ['Åland', 'Zebra', 'äpple'].map((name) => ({ name }))
      sortRows(rows, [{ key: 'name', label: 'Name' }], 'name:asc')
      expect(spy).toHaveBeenCalled()
      for (const call of spy.mock.calls) expect(call[1]).toBe('en-US')
    } finally {
      spy.mockRestore()
    }
  })
})
