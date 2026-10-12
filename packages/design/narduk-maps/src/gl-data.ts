import { markImage } from './gl-marks'

import type { DrawnPoint, DrawnShape } from './layout'
import type { PlacedLabel } from './labels'
import type { MapMetrics, MapTokens, MapView, ShapeCollection } from './types'

/** Pure builders for the GL map's GeoJSON sources. No GL import, so they are unit-testable. */

export interface FeatureLike {
  type: 'Feature'
  id?: number
  geometry: unknown
  properties: Record<string, string | number>
}

export interface CollectionLike {
  type: 'FeatureCollection'
  features: FeatureLike[]
}

export function buildShapeData(
  drawn: DrawnShape[],
  fillFor: (shape: DrawnShape) => string,
  hatch: Record<string, boolean> | undefined,
): CollectionLike {
  return {
    type: 'FeatureCollection',
    features: drawn.map((shape, index) => ({
      type: 'Feature',
      id: index,
      geometry: shape.feature.geometry,
      properties: {
        __id: shape.id,
        __name: shape.name,
        __fill: fillFor(shape),
        __hatch: hatch?.[shape.id] ? 1 : 0,
      },
    })),
  }
}

/**
 * One feature per mark. `icon` names the image to draw (see `gl-marks.ts`), `sort` puts the
 * highlighted mark on top.
 */
export function buildPointData(
  points: DrawnPoint[],
  view: MapView,
  tokens: MapTokens,
  metrics: MapMetrics,
): CollectionLike {
  return {
    type: 'FeatureCollection',
    features: points.map((p, index) => {
      const [lon, lat] = view.unproject(p.x, p.y)
      return {
        type: 'Feature',
        id: index,
        geometry: { type: 'Point', coordinates: [p.point.lon, p.point.lat] },
        properties: {
          __id: p.point.id,
          __label: p.point.label,
          __lon: lon,
          __lat: lat,
          icon: markImage(p.point.shape, p.point.color, p.highlighted, tokens, metrics).id,
          sort: p.highlighted ? 1 : 0,
        },
      }
    }),
  }
}

export const POINTS_SOURCE = 'narduk-points'
export const POINTS_LAYER = 'narduk-pt'

/**
 * The marks' layer. Symbols, not circles: only symbols take part in collision detection, which
 * is what lets the basemap's names move off the marks. Every mark is always drawn (overlap
 * allowed) but still blocks names (placement not ignored).
 */
export function pointsLayer(scale: number) {
  return {
    id: POINTS_LAYER,
    type: 'symbol' as const,
    source: POINTS_SOURCE,
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-size': scale,
      'icon-allow-overlap': true,
      'icon-ignore-placement': false,
      'icon-anchor': 'center' as const,
      'symbol-sort-key': ['get', 'sort'],
    },
  }
}

export function buildLabelData(placed: PlacedLabel[], view: MapView): CollectionLike {
  return {
    type: 'FeatureCollection',
    features: placed.map((label, index) => ({
      type: 'Feature',
      id: index,
      geometry: { type: 'Point', coordinates: view.unproject(label.x, label.y) },
      properties: { text: label.text },
    })),
  }
}

export function shapeCollectionOf(value: ShapeCollection | null | undefined): ShapeCollection {
  return value ?? { type: 'FeatureCollection', features: [] }
}

/**
 * A diagonal-hatch tile (45 degrees, like the SVG pattern) as RGBA pixels at pixel ratio 2,
 * for the GL "no data" fill pattern. `size` and `width` are the SVG pattern's, in CSS pixels.
 */
export function hatchPixels(size: number, color: [number, number, number], width: number) {
  const px = Math.max(2, Math.round(size * Math.SQRT2 * 2))
  const thickness = width * 2 * Math.SQRT2
  const data = new Uint8ClampedArray(px * px * 4)
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const diagonal = (x + y) % px
      if (Math.min(diagonal, px - diagonal) < thickness / 2) {
        const i = (y * px + x) * 4
        data[i] = color[0]
        data[i + 1] = color[1]
        data[i + 2] = color[2]
        data[i + 3] = 255
      }
    }
  }
  return { width: px, height: px, data }
}
