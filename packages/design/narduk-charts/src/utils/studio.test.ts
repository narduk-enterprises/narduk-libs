import { describe, expect, it } from 'vitest'

import {
  endLabelOnlyWidth,
  estimateTextPx,
  layoutGutterRows,
  nowTagWidth,
  placeBandLabel,
  rowsWereMoved,
} from './studio'

describe('studio gutter helpers', () => {
  it('estimates widths from character count only', () => {
    expect(estimateTextPx('1234', 10)).toBe(24)
    expect(nowTagWidth('12.5')).toBeGreaterThan(nowTagWidth('12'))
    expect(endLabelOnlyWidth('Measured')).toBeGreaterThan(endLabelOnlyWidth('Now'))
  })

  it('stacks overlapping rows apart and reports that they moved', () => {
    const rows = [
      { id: 0, y: 100 },
      { id: 1, y: 104 },
    ]
    const laid = layoutGutterRows(rows, { top: 0, bottom: 300 })
    expect(Math.abs(laid.get(1)! - laid.get(0)!)).toBeGreaterThanOrEqual(18)
    expect(rowsWereMoved(rows, laid)).toBe(true)
  })

  it('leaves well-separated rows where they are', () => {
    const rows = [
      { id: 0, y: 50 },
      { id: 1, y: 200 },
    ]
    const laid = layoutGutterRows(rows, { top: 0, bottom: 300 })
    expect(laid.get(0)).toBe(50)
    expect(laid.get(1)).toBe(200)
    expect(rowsWereMoved(rows, laid)).toBe(false)
  })

  it('places a level label at the band centre, else near an edge, else nowhere', () => {
    const band = { top: 100, bottom: 160 }
    expect(placeBandLabel(band, [])).toBe(130)
    expect(placeBandLabel(band, [130])).toBe(107)
    expect(placeBandLabel(band, [130, 107, 153])).toBeNull()
  })

  it('gives a band under 14px tall no label', () => {
    expect(placeBandLabel({ top: 100, bottom: 112 }, [])).toBeNull()
    expect(placeBandLabel({ top: 100, bottom: 114 }, [])).toBe(107)
  })
})
