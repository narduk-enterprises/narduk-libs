import { describe, expect, it } from 'vitest'
import { useCandleStream } from './useCandleStream'

describe('useCandleStream', () => {
  it('appends and trims to maxBars', () => {
    const { bars, pushBar } = useCandleStream(2)
    pushBar({ t: 1, o: 1, h: 1, l: 1, c: 1 })
    pushBar({ t: 2, o: 2, h: 2, l: 2, c: 2 })
    pushBar({ t: 3, o: 3, h: 3, l: 3, c: 3 })
    expect(bars.value.length).toBe(2)
    expect(bars.value[0]!.t).toBe(2)
    expect(bars.value[1]!.t).toBe(3)
  })

  it('replaces last bar when t matches', () => {
    const { bars, pushBar } = useCandleStream(10)
    pushBar({ t: 100, o: 1, h: 2, l: 1, c: 1.5 })
    pushBar({ t: 100, o: 1, h: 3, l: 0.5, c: 2 })
    expect(bars.value.length).toBe(1)
    expect(bars.value[0]!.h).toBe(3)
    expect(bars.value[0]!.c).toBe(2)
  })

  it('updateLast mutates trailing bar', () => {
    const { bars, pushBar, updateLast } = useCandleStream(10)
    pushBar({ t: 1, o: 1, h: 1, l: 1, c: 1 })
    updateLast({ t: 1, o: 1, h: 5, l: 1, c: 2 })
    expect(bars.value[0]!.h).toBe(5)
  })
})
