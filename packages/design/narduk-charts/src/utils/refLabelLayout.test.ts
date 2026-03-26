import { describe, expect, it } from 'vitest'
import { layoutReferenceLabelYs } from './refLabelLayout'

describe('layoutReferenceLabelYs', () => {
  it('keeps isolated labels on the line', () => {
    const m = layoutReferenceLabelYs(
      [{ id: 0, lineY: 50 }],
      { top: 10, bottom: 200 },
      { labelHeight: 12, gap: 3 },
    )
    expect(m.get(0)).toBe(50)
  })

  it('stacks labels when lines are close', () => {
    const m = layoutReferenceLabelYs(
      [
        { id: 0, lineY: 100 },
        { id: 1, lineY: 102 },
        { id: 2, lineY: 104 },
      ],
      { top: 0, bottom: 300 },
      { labelHeight: 12, gap: 3 },
    )
    const y0 = m.get(0)!
    const y1 = m.get(1)!
    const y2 = m.get(2)!
    expect(y1 - y0).toBeGreaterThanOrEqual(12 + 3 - 0.01)
    expect(y2 - y1).toBeGreaterThanOrEqual(12 + 3 - 0.01)
  })
})
