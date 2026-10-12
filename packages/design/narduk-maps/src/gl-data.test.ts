import { describe, expect, it } from 'vitest'

import { buildPointData, pointsLayer } from './gl-data'
import { markImage } from './gl-marks'
import { drawPoints } from './layout'
import { createMapView } from './projection'
import { points } from './testing/fixtures'
import { DEFAULT_METRICS, LIGHT_TOKENS } from './tokens'

import type { MarkShape } from './types'

describe('GL marks', () => {
  it('draws the points as a symbol layer, so they take part in label collision', () => {
    const layer = pointsLayer(1.5)
    expect(layer.type).toBe('symbol')
    expect(layer.layout['icon-allow-overlap']).toBe(true)
    expect(layer.layout['icon-ignore-placement']).toBe(false)
    expect(layer.layout['icon-size']).toBe(1.5)
  })

  const shapes: MarkShape[] = ['dot', 'ring', 'core', 'small', 'hollow']

  it('describes every shape with the same stacked discs the SVG draws', () => {
    for (const shape of shapes) {
      const image = markImage(shape, '#24689f', false, LIGHT_TOKENS, DEFAULT_METRICS)
      expect(image.discs.length, shape).toBeGreaterThan(0)
      expect(image.size % 2, shape).toBe(0)
      // The picture is big enough for the biggest disc and its surface ring.
      const reach = Math.max(...image.discs.map(d => d.r + (d.ring?.width ?? 0)))
      expect(image.size / 2, shape).toBeGreaterThan(reach)
    }
    // The hollow mark's dashed ring is a real dash on the canvas, not an approximation.
    const hollow = markImage('hollow', '#8b96a0', false, LIGHT_TOKENS, DEFAULT_METRICS)
    expect(hollow.discs.some(d => d.ring?.dash)).toBe(true)
  })

  it('gives each shape, colour, size and scheme its own image id', () => {
    const ids = new Set([
      markImage('dot', '#24689f', false, LIGHT_TOKENS, DEFAULT_METRICS).id,
      markImage('dot', '#24689f', true, LIGHT_TOKENS, DEFAULT_METRICS).id,
      markImage('dot', '#c98f1a', false, LIGHT_TOKENS, DEFAULT_METRICS).id,
      markImage('ring', '#24689f', false, LIGHT_TOKENS, DEFAULT_METRICS).id,
      markImage('dot', '#24689f', false, { ...LIGHT_TOKENS, markRing: '#000000' }, DEFAULT_METRICS)
        .id,
    ])
    expect(ids.size).toBe(5)
    for (const id of ids) expect(id).toMatch(/^nm-mark-/)
  })

  it('builds one feature per point naming its image, highlighted last', () => {
    const view = createMapView({ bounds: [-71.4, 41.4, -71.2, 41.7], width: 400 })
    const drawn = drawPoints(points, 'p3', view, DEFAULT_METRICS)
    const data = buildPointData(drawn, view, LIGHT_TOKENS, DEFAULT_METRICS)
    expect(data.features).toHaveLength(points.length)
    for (const f of data.features) {
      expect(String(f.properties.icon)).toMatch(/^nm-mark-/)
      expect(f.properties).not.toHaveProperty('r0')
    }
    const last = data.features.at(-1)
    expect(last?.properties.__id).toBe('p3')
    expect(last?.properties.sort).toBe(1)
    expect(String(last?.properties.icon)).toContain('-hl-')
  })
})
