import { describe, expect, it } from 'vitest'

import { overflowEdges } from '../../src/marks/overflow.js'

describe('overflowEdges', () => {
  it('reports no overflow when content fits in the visible area', () => {
    expect(overflowEdges(0, 366, 366)).toEqual({ end: false, start: false })
    expect(overflowEdges(0, 366, 366.4)).toEqual({ end: false, start: false })
  })

  it('flags the end when the row is clipped at rest', () => {
    // 390px phone board, 12px chrome padding each side, chips wider than 366.
    expect(overflowEdges(0, 366, 560)).toEqual({ end: true, start: false })
  })

  it('flags the start after the row has been scrolled', () => {
    expect(overflowEdges(80, 366, 560)).toEqual({ end: true, start: true })
  })

  it('clears the end flag once the last chip is fully in view', () => {
    expect(overflowEdges(194, 366, 560)).toEqual({ end: false, start: true })
  })
})
