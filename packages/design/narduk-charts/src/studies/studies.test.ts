import { describe, expect, it } from 'vitest'
import type { CandleBar } from '../types'
import { sma } from './sma'
import { ema } from './ema'
import { vwap } from './vwap'
import { bollinger } from './bollinger'
import { rsi } from './rsi'
import { macd } from './macd'

describe('sma', () => {
  it('pads with null until period filled', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })
})

describe('ema', () => {
  it('starts after period-1', () => {
    const e = ema([1, 2, 3, 4, 5, 6], 3)
    expect(e[0]).toBeNull()
    expect(e[1]).toBeNull()
    expect(e[2]).toBeCloseTo(2, 5)
  })
})

describe('vwap', () => {
  it('accumulates typical price', () => {
    const bars: CandleBar[] = [
      { t: 0, o: 10, h: 12, l: 9, c: 11, v: 100 },
      { t: 1, o: 11, h: 13, l: 10, c: 12, v: 200 },
    ]
    const v = vwap(bars)
    const tp0 = (12 + 9 + 11) / 3
    expect(v[0]).toBeCloseTo(tp0, 5)
  })
})

describe('bollinger', () => {
  it('widens with volatility', () => {
    const closes = [10, 10, 10, 12, 8, 14, 6, 11, 9, 13]
    const b = bollinger(closes, 5, 2)
    const row = b[closes.length - 1]!
    expect(row.mid).not.toBeNull()
    expect(row.upper!).toBeGreaterThan(row.mid!)
    expect(row.lower!).toBeLessThan(row.mid!)
  })
})

describe('rsi', () => {
  it('returns null until enough samples', () => {
    const r = rsi([100, 101], 14)
    expect(r.every(x => x === null)).toBe(true)
  })
  it('trends high on up moves', () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5)
    const r = rsi(up, 14)
    const last = r[r.length - 1]!
    expect(last).toBeGreaterThan(60)
  })
})

describe('macd', () => {
  it('produces aligned arrays', () => {
    const c = Array.from({ length: 50 }, (_, i) => 50 + Math.sin(i / 5) * 2)
    const m = macd(c)
    expect(m.line.length).toBe(c.length)
    expect(m.signal.length).toBe(c.length)
  })
})
