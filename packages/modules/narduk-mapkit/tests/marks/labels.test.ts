import { describe, expect, it } from 'vitest'

import { labelBox, placeLabels } from '../../src/marks/labels.js'

import type { LabelBox, LabelDisc } from '../../src/marks/labels.js'

const SIZE = { height: 13, width: 60 }

function disc(id: string, x: number, y: number, radius = 12): LabelDisc {
  return { id, radius, x, y }
}

function place(discs: LabelDisc[], order: string[], blocked: LabelBox[] = []) {
  return placeLabels({
    blocked,
    discs,
    gap: 2,
    offset: 2,
    requests: order.map((id) => ({ ...SIZE, id })),
  })
}

describe('placeLabels', () => {
  it('hangs a label centred below its own disc', () => {
    expect(labelBox(disc('A', 100, 100), { ...SIZE, id: 'A' }, 2)).toEqual({
      bottom: 127,
      left: 70,
      right: 130,
      top: 114,
    })
  })

  it('places every label on a sparse field', () => {
    const discs = [disc('A', 0, 0), disc('B', 200, 0), disc('C', 0, 200)]
    expect(place(discs, ['A', 'B', 'C'])).toEqual(['A', 'B', 'C'])
  })

  it('drops a label that would cover another pin, never the pin', () => {
    const discs = [disc('A', 100, 100), disc('B', 110, 128, 6)]
    expect(place(discs, ['A', 'B'])).toEqual(['B'])
  })

  it('gives a contested spot to the label asked for first', () => {
    const discs = [disc('A', 100, 100), disc('B', 150, 100)]
    expect(place(discs, ['B', 'A'])).toEqual(['B'])
    expect(place(discs, ['A', 'B'])).toEqual(['A'])
  })

  it('keeps labels out of blocked boxes', () => {
    const blocked = [{ bottom: 140, left: 90, right: 200, top: 112 }]
    expect(place([disc('A', 100, 100)], ['A'], blocked)).toEqual([])
  })

  it('ignores a request with no disc', () => {
    expect(place([disc('A', 0, 0)], ['Z', 'A'])).toEqual(['A'])
  })
})
