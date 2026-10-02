import {
  POINT_CLASS_NO_DATA,
  POINT_CLASS_NOT_REPORTING,
  createPointLayer,
} from '@narduk-enterprises/narduk-mapkit/client'

import type {
  PointClassTable,
  VectorTileCoordinate,
} from '@narduk-enterprises/narduk-mapkit/client'

interface MapHandle {
  addEventListener(type: 'single-tap', listener: (event: { pointOnPage: Point }) => void): void
  convertPointOnPageToCoordinate(point: Point): VectorTileCoordinate | null
}

interface Point {
  x: number
  y: number
}

/**
 * Draw every gauge on the national map as a canvas dot, and answer a tap.
 *
 * 23,597 DOM annotations is past what the keyed pin layer was built for.
 * Positions arrive as a typed-array column (longitude, latitude), class is a
 * `Uint8Array`, and a lens change replaces that class column -- the points
 * are not re-projected. `imageForTile` is the same function the vector tile
 * painter hands the async overlay.
 *
 * Class 255 is no data and class 254 is not reporting. They are reserved so
 * neither state can be confused with class 0, the lowest real status.
 */
export function attachGaugePoints(
  map: MapHandle,
  columns: {
    classes: Uint8Array
    flags?: Uint8Array
    positions: Float32Array | Float64Array
  },
) {
  const style: PointClassTable = {
    [POINT_CLASS_NO_DATA]: { fill: '#94a3b8', order: 0, radius: 2.5, stroke: '#475569' },
    [POINT_CLASS_NOT_REPORTING]: { fill: '#e2e8f0', order: 1, radius: 2.5, stroke: '#94a3b8' },
    0: { fill: '#16a34a', order: 2, radius: 3, stroke: '#14532d' },
    4: { fill: '#dc2626', order: 8, radius: 3.5, stroke: '#7f1d1d' },
  }

  const layer = createPointLayer({
    classes: columns.classes,
    createCanvas: (width, height) => new OffscreenCanvas(width, height),
    flags: columns.flags,
    positions: columns.positions,
    style,
  })

  map.addEventListener('single-tap', (event) => {
    const coordinate = map.convertPointOnPageToCoordinate(event.pointOnPage)
    if (!coordinate) return
    // A fingertip, not a pixel. Overlapping dots resolve by draw order so
    // the status the user can see is the one the tap returns.
    const index = layer.nearestPoint(coordinate, 16, currentZoom())
    if (index !== null) showGauge(index)
    else dismissGauge()
  })

  return {
    /** Pass to `createMapKitAsyncTileOverlay`. */
    imageForTile: layer.imageForTile,
    /**
     * Apply a new lens. The class column is replaced in place; positions stay
     * as they were projected on the first call.
     */
    applyLens(classes: Uint8Array, nextStyle: PointClassTable) {
      layer.setStyle(nextStyle)
      layer.setClasses(classes)
      reloadOverlay()
    },
  }
}

declare function currentZoom(): number
declare function dismissGauge(): void
declare function reloadOverlay(): void
declare function showGauge(index: number): void
