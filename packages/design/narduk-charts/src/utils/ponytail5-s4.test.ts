// ponytail-5 s4 audit regression tests
import { describe, expect, it } from 'vitest'
import { sma } from '../studies/sma'
import { bollinger } from '../studies/bollinger'

describe('maps-charts #5: a NaN sample leaves the moving average once it leaves the window', () => {
  it('sma recovers after the window passes the NaN', () => {
    expect(sma([1, Number.NaN, 3, 4, 5, 6, 7], 3)).toEqual([null, null, null, null, 4, 5, 6])
  })
  it('bollinger bands recover too', () => {
    const rows = bollinger([1, Number.NaN, 3, 4, 5, 6, 7], 3)
    expect(rows[2]!.mid).toBeNull()
    expect(rows[6]!.mid).toBe(6)
  })
})
