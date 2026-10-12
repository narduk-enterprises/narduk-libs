import { describe, expect, it } from 'vitest'

import {
  type labelBox,
  labelAnchor,
  labelHitsObstacle,
  placeLabels,
  poleOfInaccessibility,
  type Obstacle,
} from './labels'
import type { ViewPoint } from './projection'

const square = (x: number, y: number, size: number): ViewPoint[] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
]

const options = { width: 300, height: 200, fontSize: 11, charWidth: 0.74 }

describe('pole of inaccessibility', () => {
  it('finds the middle of a square', () => {
    const [x, y] = poleOfInaccessibility([square(10, 10, 100)])
    expect(x).toBeCloseTo(60, 0)
    expect(y).toBeCloseTo(60, 0)
  })

  it('stays inside an L shape, in its fat arm', () => {
    const l: ViewPoint[] = [
      [0, 0],
      [100, 0],
      [100, 20],
      [20, 20],
      [20, 100],
      [0, 100],
    ]
    const [x, y] = poleOfInaccessibility([l])
    const inArm = (x >= 0 && x <= 100 && y >= 0 && y <= 20) || (x >= 0 && x <= 20 && y <= 100)
    expect(inArm).toBe(true)
  })

  it('uses the largest polygon of a multipolygon', () => {
    const anchor = labelAnchor([[square(0, 0, 10)], [square(100, 100, 60)]])
    expect(anchor?.[0]).toBeGreaterThan(100)
  })
})

describe('label placement', () => {
  it('clamps a label inside the frame', () => {
    const [placed] = placeLabels([{ id: 'a', text: 'Leavenworth', x: 2, y: 4 }], [], options)
    expect(placed?.box.x0).toBeGreaterThanOrEqual(0)
    expect(placed?.box.y0).toBeGreaterThanOrEqual(0)
    const [right] = placeLabels([{ id: 'b', text: 'Leavenworth', x: 299, y: 100 }], [], options)
    expect(right?.box.x1).toBeLessThanOrEqual(300)
  })

  it('moves a label off a mark sitting on its anchor', () => {
    const obstacles: Obstacle[] = [{ x: 150, y: 100, r: 10 }]
    const [placed] = placeLabels(
      [{ id: 'a', text: 'Middletown', x: 150, y: 100 }],
      obstacles,
      options,
    )
    expect(placed).toBeDefined()
    expect(labelHitsObstacle((placed as NonNullable<typeof placed>).box, obstacles)).toBe(false)
  })

  it('never overlaps a mark, even in a crowd', () => {
    const obstacles: Obstacle[] = []
    for (let i = 0; i < 40; i++) {
      obstacles.push({ x: 20 + ((i * 37) % 260), y: 20 + ((i * 53) % 160), r: 9 })
    }
    const items = [
      { id: 'a', text: 'Portsmouth', x: 150, y: 90 },
      { id: 'b', text: 'Middletown', x: 100, y: 120 },
      { id: 'c', text: 'Newport', x: 200, y: 60 },
    ]
    for (const placed of placeLabels(items, obstacles, options)) {
      expect(labelHitsObstacle(placed.box, obstacles)).toBe(false)
    }
  })

  it('keeps labels apart from each other', () => {
    const placed = placeLabels(
      [
        { id: 'a', text: 'Middletown', x: 150, y: 100 },
        { id: 'b', text: 'Newport', x: 150, y: 100 },
      ],
      [],
      options,
    )
    const [a, b] = placed.map(p => p.box) as [
      ReturnType<typeof labelBox>,
      ReturnType<typeof labelBox>,
    ]
    const overlap = a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
    expect(overlap).toBe(false)
  })

  it('counts the level line when it is printed under the name', () => {
    const obstacles: Obstacle[] = [{ x: 150, y: 112, r: 8 }]
    const [placed] = placeLabels(
      [{ id: 'a', text: 'Jackson', sub: ['Very Low'], x: 150, y: 100 }],
      obstacles,
      options,
    )
    expect(labelHitsObstacle((placed as NonNullable<typeof placed>).box, obstacles)).toBe(false)
  })
})
