import { describe, expect, it } from 'vitest'
import {
  aggregateCandlesToResolution,
  CANDLE_RESOLUTION_MS,
  resolutionMsFromId,
} from './candleResolution'

describe('aggregateCandlesToResolution', () => {
  it('buckets 1m bars into 5m OHLC', () => {
    const t0 = Date.UTC(2026, 0, 15, 14, 0, 0)
    const bars = [
      { t: t0, o: 100, h: 101, l: 99, c: 100.5, v: 100 },
      { t: t0 + 60_000, o: 100.5, h: 102, l: 100, c: 101, v: 200 },
      { t: t0 + 2 * 60_000, o: 101, h: 103, l: 100.5, c: 102, v: 150 },
      { t: t0 + 3 * 60_000, o: 102, h: 102.5, l: 101, c: 101.5, v: 120 },
      { t: t0 + 4 * 60_000, o: 101.5, h: 104, l: 101, c: 103, v: 180 },
    ]
    const out = aggregateCandlesToResolution(bars, CANDLE_RESOLUTION_MS['5m'])
    expect(out.length).toBe(1)
    expect(out[0]).toMatchObject({
      t: t0,
      o: 100,
      h: 104,
      l: 99,
      c: 103,
      v: 750,
    })
  })

  it('sorts unsorted input by time', () => {
    const t0 = 1_000_000
    const bars = [
      { t: t0 + 120_000, o: 3, h: 3, l: 3, c: 3 },
      { t: t0, o: 1, h: 1, l: 1, c: 1 },
      { t: t0 + 60_000, o: 2, h: 2, l: 2, c: 2 },
    ]
    const out = aggregateCandlesToResolution(bars, 60_000)
    expect(out.map(b => b.c)).toEqual([1, 2, 3])
  })
})

describe('resolutionMsFromId', () => {
  it('matches map', () => {
    expect(resolutionMsFromId('1h')).toBe(3_600_000)
  })
})
