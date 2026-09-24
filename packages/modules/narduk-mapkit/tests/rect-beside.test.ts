import { describe, expect, it } from 'vitest'

import { pointBesideAnchor, rectBeside } from '../src/client/index.js'

const FRAME = { height: 1000, width: 1000 }
const RECT = { origin: { x: 0.2, y: 0.3 }, size: { height: 0.1, width: 0.1 } }
/** World (0.22, 0.32) under RECT. */
const POINT = { x: 200, y: 200 }
const LEFT_CARD = { height: 400, width: 300, x: 0, y: 100 }

describe('pointBesideAnchor', () => {
  it('sits to the right of a left-hand card, at its vertical centre', () => {
    expect(pointBesideAnchor(FRAME, LEFT_CARD, { gap: 20 })).toStrictEqual({ x: 320, y: 300 })
  })

  it('sits to the left of a right-hand card', () => {
    const card = { height: 400, width: 300, x: 700, y: 100 }
    expect(pointBesideAnchor(FRAME, card, { gap: 20 })).toStrictEqual({ x: 680, y: 300 })
  })

  it('honours an explicit vertical target', () => {
    expect(pointBesideAnchor(FRAME, LEFT_CARD, { gap: 20, verticalTarget: 180 })).toStrictEqual({
      x: 320,
      y: 180,
    })
  })
})

describe('rectBeside (narduk-libs#517)', () => {
  it('pans so the coordinate lands beside the card at the current zoom', () => {
    const next = rectBeside(RECT, FRAME, POINT, LEFT_CARD, { gap: 20 })

    expect(next.size).toStrictEqual(RECT.size)
    expect(next.origin.x).toBeCloseTo(0.188, 10)
    expect(next.origin.y).toBeCloseTo(0.29, 10)
    expect(POINT.x * (RECT.size.width / FRAME.width) + RECT.origin.x).toBeCloseTo(
      320 * (next.size.width / FRAME.width) + next.origin.x,
      10,
    )
    expect(POINT.y * (RECT.size.height / FRAME.height) + RECT.origin.y).toBeCloseTo(
      300 * (next.size.height / FRAME.height) + next.origin.y,
      10,
    )
  })

  it('applies one extra zoom step around the coordinate when clustered', () => {
    const next = rectBeside(RECT, FRAME, POINT, LEFT_CARD, { clustered: true, gap: 20 })

    expect(next.size.width).toBeCloseTo(0.05, 10)
    expect(next.size.height).toBeCloseTo(0.05, 10)
    expect(POINT.x * (RECT.size.width / FRAME.width) + RECT.origin.x).toBeCloseTo(
      320 * (next.size.width / FRAME.width) + next.origin.x,
      10,
    )
  })

  it('returns a copy of the input rect when the frame has no extent', () => {
    const next = rectBeside(RECT, { height: 0, width: 0 }, POINT, LEFT_CARD)

    expect(next).toStrictEqual(RECT)
    expect(next).not.toBe(RECT)
  })
})
