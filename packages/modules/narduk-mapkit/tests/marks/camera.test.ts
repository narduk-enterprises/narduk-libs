import { describe, expect, it } from 'vitest'

import {
  frameContains,
  frameToCoordinate,
  projectToFrame,
  rectForBox,
  rectRevealing,
  tierForSpan,
  zoomRect,
} from '../../src/marks/camera.js'

const WORLD = { origin: { x: 0, y: 0 }, size: { height: 1, width: 1 } }
const SQUARE = { height: 1000, width: 1000 }
const DESKTOP = { height: 844, width: 1440 }
const CARD_OPEN = { bottom: 0, left: 392, right: 412, top: 0 }
const PHONE = { height: 844, width: 390 }
/** Phone chrome with the sheet at the station detent: top edge 380, chrome 164. */
const SHEET_OPEN = { bottom: 464, left: 0, right: 0, top: 164 }
/** The sheet at its tallest detent covers more of the frame than is left. */
const SHEET_FULL = { bottom: 772, left: 0, right: 0, top: 164 }
/** The phone's opening camera: 76 degrees of longitude, at the frame's aspect. */
const PHONE_RECT = {
  origin: { x: 0.127, y: 0.1877 },
  size: { height: (0.2127 * 844) / 390, width: 0.2127 },
}
const GALVESTON = { lat: 29.232, lon: -94.413 }

describe('tierForSpan', () => {
  it('switches tiers at zoom 5.5, 7.4 and 9.3', () => {
    expect(tierForSpan(45, 1440)).toBe('overview')
    expect(tierForSpan(44, 1440)).toBe('regional')
    expect(tierForSpan(11, 1440)).toBe('local')
    expect(tierForSpan(3.3, 1440)).toBe('local')
    expect(tierForSpan(3.2, 1440)).toBe('close')
  })
})

describe('frame projection', () => {
  it('maps the whole world onto the frame', () => {
    expect(projectToFrame(WORLD, SQUARE, { lat: 0, lon: 0 })).toEqual({ x: 500, y: 500 })
    expect(projectToFrame(WORLD, SQUARE, { lat: 0, lon: 90 })).toEqual({ x: 750, y: 500 })
  })

  it('keeps points either side of the antimeridian next to each other', () => {
    const rect = { origin: { x: 0.9, y: 0.3 }, size: { height: 0.2, width: 0.2 } }
    expect(projectToFrame(rect, SQUARE, { lat: 0, lon: -175 }).x).toBeCloseTo(569.4, 1)
    expect(projectToFrame(rect, SQUARE, { lat: 0, lon: 175 }).x).toBeCloseTo(430.6, 1)
  })

  it('round-trips frame pixels back to coordinates', () => {
    const rect = { origin: { x: 0.2, y: 0.38 }, size: { height: 0.04, width: 0.0682 } }
    const frame = { height: 844, width: 1440 }
    const point = projectToFrame(rect, frame, GALVESTON)
    const back = frameToCoordinate(rect, frame, point)
    expect(back.lat).toBeCloseTo(GALVESTON.lat, 6)
    expect(back.lon).toBeCloseTo(GALVESTON.lon, 6)
  })

  it('tests frame membership with a margin', () => {
    expect(frameContains(SQUARE, { x: -20, y: 10 })).toBe(false)
    expect(frameContains(SQUARE, { x: -20, y: 10 }, 30)).toBe(true)
  })
})

describe('camera moves', () => {
  it('fits a box inside the free area and centres it there', () => {
    const box = { east: -80, north: 31, south: 18, west: -98 }
    const rect = rectForBox(box, DESKTOP, CARD_OPEN)
    const centre = projectToFrame(rect, DESKTOP, { lat: 24.5, lon: -89 })
    const northWest = projectToFrame(rect, DESKTOP, { lat: box.north, lon: box.west })
    const southEast = projectToFrame(rect, DESKTOP, { lat: box.south, lon: box.east })
    expect(centre.x).toBeCloseTo(392 + (1440 - 392 - 412) / 2, 0)
    expect(northWest.x).toBeGreaterThanOrEqual(392 + 31)
    expect(southEast.x).toBeLessThanOrEqual(1440 - 412 - 31)
    expect(northWest.y).toBeGreaterThanOrEqual(31)
    expect(southEast.y).toBeLessThanOrEqual(844 - 31)
  })

  it('caps the zoom for a single point', () => {
    const rect = rectForBox(
      { east: -94.413, north: 29.232, south: 29.232, west: -94.413 },
      DESKTOP,
      CARD_OPEN,
      { maxZoom: 11 },
    )
    expect(rect.size.width).toBeCloseTo(1440 / (256 * 2 ** 11), 8)
  })

  it('pans a point hidden under the card into the free area', () => {
    const rect = rectForBox({ east: -80, north: 31, south: 18, west: -98 }, DESKTOP, {
      bottom: 0,
      left: 0,
      right: 0,
      top: 0,
    })
    const hidden = { x: 1300, y: 400 }
    const moved = rectRevealing(rect, DESKTOP, CARD_OPEN, hidden)
    expect(moved).not.toBeNull()
    const coordinate = frameToCoordinate(rect, DESKTOP, hidden)
    const after = projectToFrame(moved ?? rect, DESKTOP, coordinate)
    expect(after.x).toBeCloseTo(710, 0)
    expect(after.y).toBeCloseTo(422, 0)
    expect(rectRevealing(rect, DESKTOP, CARD_OPEN, { x: 700, y: 400 })).toBeNull()
  })

  it('keeps the zoom when it pans a mark out from under the phone sheet', () => {
    const hidden = { x: 284, y: 419 }
    const moved = rectRevealing(PHONE_RECT, PHONE, SHEET_OPEN, hidden)
    expect(moved?.size.width).toBeCloseTo(PHONE_RECT.size.width, 12)
    expect(moved?.size.height).toBeCloseTo(PHONE_RECT.size.height, 12)
    const coordinate = frameToCoordinate(PHONE_RECT, PHONE, hidden)
    const after = projectToFrame(moved ?? PHONE_RECT, PHONE, coordinate)
    expect(after.x).toBeCloseTo(195, 0)
    expect(after.y).toBeCloseTo(272, 0)
  })

  it('leaves a band to aim at when the chrome covers more than the frame', () => {
    const hidden = { x: 284, y: 600 }
    const moved = rectRevealing(PHONE_RECT, PHONE, SHEET_FULL, hidden)
    const coordinate = frameToCoordinate(PHONE_RECT, PHONE, hidden)
    const after = projectToFrame(moved ?? PHONE_RECT, PHONE, coordinate)
    expect(moved?.size.height).toBeCloseTo(PHONE_RECT.size.height, 12)
    expect(after.y).toBeGreaterThan(164)
    expect(after.y).toBeLessThan(380)

    // The band the box is framed in never collapses, so the zoom stays sane:
    // dividing by a one-pixel band used to throw the camera out to the world.
    const box = { east: -80, north: 31, south: 18, west: -98 }
    expect(rectForBox(box, PHONE, SHEET_FULL).size.width).toBeLessThan(1)
    expect(rectForBox(box, PHONE, SHEET_FULL).size.width).toBeCloseTo(
      rectForBox(box, { height: 96 + 164, width: 390 }, { ...SHEET_FULL, bottom: 0 }).size.width,
      3,
    )
  })

  it('zooms around the centre', () => {
    const zoomed = zoomRect({ origin: { x: 0.2, y: 0.4 }, size: { height: 0.1, width: 0.2 } }, 2)
    expect(zoomed.size).toEqual({ height: 0.05, width: 0.1 })
    expect(zoomed.origin.x + zoomed.size.width / 2).toBeCloseTo(0.3, 10)
    expect(zoomed.origin.y + zoomed.size.height / 2).toBeCloseTo(0.45, 10)
  })
})
