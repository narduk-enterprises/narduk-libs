import { describe, expect, it, vi } from 'vitest'

import { cachedAnalyticsFetch, resolveAnalyticsDateRange } from '../server/utils/analyticsCache'

describe('cachedAnalyticsFetch', () => {
  it('calls the fetcher once and marks the second call as cached within the TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue({ hello: 'world' })

    const first = await cachedAnalyticsFetch('test:key:1', fetcher, 60_000)
    const second = await cachedAnalyticsFetch('test:key:1', fetcher, 60_000)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(second.data).toEqual({ hello: 'world' })
  })

  it('re-fetches once the TTL has expired', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 })

    const first = await cachedAnalyticsFetch('test:key:2', fetcher, 1)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await cachedAnalyticsFetch('test:key:2', fetcher, 1)

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(first.data).toEqual({ v: 1 })
    expect(second.data).toEqual({ v: 2 })
    expect(second.cached).toBe(false)
  })

  it('keys are independent — a miss on one key does not disturb another', async () => {
    const fetcherA = vi.fn().mockResolvedValue({ v: 'a' })
    const fetcherB = vi.fn().mockResolvedValue({ v: 'b' })

    await cachedAnalyticsFetch('test:key:a', fetcherA, 60_000)
    await cachedAnalyticsFetch('test:key:b', fetcherB, 60_000)
    const secondA = await cachedAnalyticsFetch('test:key:a', fetcherA, 60_000)

    expect(fetcherA).toHaveBeenCalledTimes(1)
    expect(fetcherB).toHaveBeenCalledTimes(1)
    expect(secondA.data).toEqual({ v: 'a' })
  })
})

describe('resolveAnalyticsDateRange', () => {
  it('defaults endDate to today and startDate to defaultDays back', () => {
    const { startDate, endDate } = resolveAnalyticsDateRange({}, 30)
    const diffDays = Math.round(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / (24 * 60 * 60 * 1000),
    )
    expect(diffDays).toBe(30)
  })

  it('supports a same-day range with defaultDays: 0', () => {
    const { startDate, endDate } = resolveAnalyticsDateRange({}, 0)
    expect(startDate).toBe(endDate)
  })

  it('uses explicit startDate/endDate when both are provided', () => {
    const { startDate, endDate } = resolveAnalyticsDateRange({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    })
    expect(startDate).toBe('2026-01-01')
    expect(endDate).toBe('2026-01-31')
  })

  it('swaps the range when startDate is after endDate', () => {
    const { startDate, endDate } = resolveAnalyticsDateRange({
      startDate: '2026-02-01',
      endDate: '2026-01-01',
    })
    expect(startDate).toBe('2026-01-01')
    expect(endDate).toBe('2026-02-01')
  })
})
