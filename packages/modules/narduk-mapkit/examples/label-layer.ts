import { createLabelLayer } from '@narduk-enterprises/narduk-mapkit/client'

import type {
  LabelAnchor,
  LabelHit,
  LabelView,
  PointLayer,
  PointLayerCanvas,
} from '@narduk-enterprises/narduk-mapkit/client'

/** Anchors as the tile host publishes them: columns, then rows in that order. */
interface PublishedAnchors {
  anchors: Array<
    [name: string, order: number, id: number, point: [number, number], minzoom: number]
  >
}

/**
 * Name the big rivers without covering a gauge dot or another name.
 *
 * The layer is generic: it gets anchors (text, position, priority, first zoom,
 * optional id), a style, and a function that returns the marks to avoid. The
 * app passes its visible gauge dots from the point layer; nothing here knows
 * the anchors are rivers. A label that does not fit is dropped for the frame,
 * never moved or shrunk.
 */
export function attachRiverNames(
  published: PublishedAnchors,
  gauges: Pick<PointLayer<PointLayerCanvas>, 'obstaclesInView'>,
  canvas: HTMLCanvasElement,
) {
  const anchors: LabelAnchor[] = published.anchors.map(
    ([text, order, id, [longitude, latitude], minzoom]) => ({
      id,
      latitude,
      longitude,
      minZoom: minzoom,
      // Stream order is already "bigger is more important".
      priority: order,
      text,
    }),
  )

  const labels = createLabelLayer({
    anchors,
    canvas,
    createCanvas: (width, height) => new OffscreenCanvas(width, height),
    // The caller's colours: nothing is hard-coded in the package.
    style: {
      fill: '#0f172a',
      fontFamily: 'system-ui, sans-serif',
      fontSize: 11,
      fontWeight: 600,
      halo: 'rgba(255, 255, 255, 0.9)',
      haloWidth: 3,
    },
    // The dots as screen circles, read from the point layer's typed arrays.
    obstacles: (view) => gauges.obstaclesInView(view),
  })

  /** Call from the map's region-change handler; many calls in a frame paint once. */
  function onRegionChange(view: Omit<LabelView, 'pixelRatio'>) {
    labels.requestPaint({ ...view, pixelRatio: window.devicePixelRatio })
  }

  /** The label under a tap, from the last painted frame; `resolveHit` can ask this too. */
  function nameAt(
    coordinate: { latitude: number; longitude: number },
    zoom: number,
  ): LabelHit | null {
    return labels.labelAt(coordinate, 8, zoom)
  }

  return { nameAt, onRegionChange }
}
